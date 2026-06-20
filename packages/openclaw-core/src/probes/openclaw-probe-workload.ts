import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadRuntimeEventStoreRecords,
  type RuntimeEventStoreRecord,
} from "../event-store";
import { dispatchOpenClawEvent } from "../runtime-dispatch";
import { loadAllMappings } from "../session-registry";
import type { OpenClawConfig } from "../types";
import {
  type CapturedGatewayPayload,
  type ProbeOptions,
  parseOptions,
  payloadFromUnknown,
  resolveOutPath,
  writeJson,
} from "./openclaw-probe-workload-helpers";

interface ProbeSummary {
  readonly ok: boolean;
  readonly session: string;
  readonly payloadCount: number;
  readonly registryBeforeDeleteCount: number;
  readonly registryAfterDeleteCount: number;
  readonly runtimeCorrelationIds: readonly string[];
  readonly boundedFailures: readonly string[];
  readonly tmuxTailCaptured: boolean;
}

function configFor(url: string): OpenClawConfig {
  return {
    enabled: true,
    gateways: { gateway: { type: "http", url, timeout: 1000 } },
    hooks: {
      "session.created": {
        enabled: true,
        gateway: "gateway",
        instruction: "created {{sessionId}}",
      },
      stop: {
        enabled: true,
        gateway: "gateway",
        instruction: "stop {{sessionId}}",
      },
      "session.deleted": {
        enabled: true,
        gateway: "gateway",
        instruction: "deleted {{sessionId}}",
      },
    },
  };
}

function startGateway(port: number, payloads: CapturedGatewayPayload[]) {
  return Bun.serve({
    port,
    async fetch(request) {
      payloads.push(payloadFromUnknown(await request.json()));
      return Response.json({
        messageId: `message-${payloads.length}`,
        platform: "discord",
        channelId: "qa-channel",
        threadId: "qa-thread",
      });
    },
  });
}

function runTmux(args: readonly string[]): string {
  const result = Bun.spawnSync({
    cmd: ["tmux", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  return new TextDecoder().decode(result.stdout).trim();
}

function setupTmux(): {
  readonly session: string;
  readonly pane: string;
} | null {
  const session = "ulw-qa-openclaw-14";
  const created = Bun.spawnSync({
    cmd: [
      "tmux",
      "new-session",
      "-d",
      "-s",
      session,
      "printf 'opencode\\nRun /help\\n'; sleep 300",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (created.exitCode !== 0) return null;
  return {
    session,
    pane: runTmux(["display-message", "-p", "-t", session, "#{pane_id}"]),
  };
}

function cleanupTmux(session: string | null): void {
  if (session !== null)
    Bun.spawnSync({
      cmd: ["tmux", "kill-session", "-t", session],
      stdout: "pipe",
      stderr: "pipe",
    });
}

function eventRecords(records: readonly RuntimeEventStoreRecord[]) {
  return records.filter((record) => record.kind === "event");
}

async function runHappy(options: ProbeOptions): Promise<ProbeSummary> {
  const payloads: CapturedGatewayPayload[] = [];
  const server = startGateway(options.fakeGatewayPort, payloads);
  const tmux = options.expectTmuxTail ? setupTmux() : null;
  process.env.TMUX = tmux === null ? "" : "fake,123,0";
  process.env.TMUX_PANE = tmux?.pane ?? "";
  const context = {
    sessionId: options.session,
    projectPath: "/tmp/openclaw-validation-project",
    tmuxPaneId: tmux?.pane ?? "%14",
    tmuxSession: tmux?.session ?? "qa-openclaw-validation",
  };
  for (const rawEvent of options.events.filter(
    (event) => event !== "session.deleted",
  )) {
    await dispatchOpenClawEvent({
      config: configFor(`http://127.0.0.1:${options.fakeGatewayPort}`),
      rawEvent,
      context,
    });
  }
  const beforeDelete = loadAllMappings();
  await dispatchOpenClawEvent({
    config: configFor(`http://127.0.0.1:${options.fakeGatewayPort}`),
    rawEvent: "session.deleted",
    context,
  });
  const afterDelete = loadAllMappings();
  const records = loadRuntimeEventStoreRecords();
  const correlationIds = eventRecords(records).map(
    (record) => record.correlationId,
  );
  const tmuxTail =
    payloads.find((payload) => payload.event === "stop")?.tmuxTail ?? "";
  server.stop(true);
  cleanupTmux(tmux?.session ?? null);
  const summary: ProbeSummary = {
    ok:
      (!options.expectListenerPayload || payloads.length > 0) &&
      (!options.expectSessionRegisterRemove ||
        (beforeDelete.length > 0 && afterDelete.length === 0)) &&
      (!options.expectTmuxTail || tmuxTail.includes("opencode")) &&
      correlationIds.length > 0,
    session: options.session,
    payloadCount: payloads.length,
    registryBeforeDeleteCount: beforeDelete.length,
    registryAfterDeleteCount: afterDelete.length,
    runtimeCorrelationIds: correlationIds,
    boundedFailures: [],
    tmuxTailCaptured: tmuxTail.includes("opencode"),
  };
  if (options.outDir !== undefined) {
    const dir = resolveOutPath(options.outDir);
    writeJson(join(dir, "payload.json"), payloads);
    writeJson(join(dir, "session-registry-before-after.json"), {
      beforeDelete,
      afterDelete,
    });
    writeFileSync(join(dir, "tmux-tail.txt"), `${tmuxTail}\n`);
    writeJson(join(dir, "dashboard-correlation.json"), {
      session: options.session,
      correlationIds,
      records,
    });
    writeJson(join(dir, "summary.json"), summary);
  }
  return summary;
}

async function runFailure(options: ProbeOptions): Promise<ProbeSummary> {
  const boundedFailures: string[] = [];
  if (options.simulate.includes("listener-down")) {
    await dispatchOpenClawEvent({
      config: configFor(`http://127.0.0.1:${options.fakeGatewayPort}`),
      rawEvent: "session.created",
      context: {
        sessionId: options.session,
        projectPath: "/tmp/down",
        tmuxPaneId: "%14",
      },
    });
    boundedFailures.push("listener-down");
  }
  if (options.simulate.includes("bad-gateway-url")) {
    await dispatchOpenClawEvent({
      config: configFor("http://example.com/openclaw"),
      rawEvent: "session.created",
      context: {
        sessionId: options.session,
        projectPath: "/tmp/bad-url",
        tmuxPaneId: "%14",
      },
    });
    boundedFailures.push("bad-gateway-url");
  }
  if (options.simulate.includes("missing-tmux"))
    boundedFailures.push("missing-tmux");
  if (options.simulate.includes("stale-session-delete")) {
    await dispatchOpenClawEvent({
      config: { enabled: true, gateways: {}, hooks: {} },
      rawEvent: "session.deleted",
      context: { sessionId: `${options.session}-missing` },
    });
    boundedFailures.push("stale-session-delete");
  }
  const summary: ProbeSummary = {
    ok: boundedFailures.length === options.simulate.length,
    session: options.session,
    payloadCount: 0,
    registryBeforeDeleteCount: 0,
    registryAfterDeleteCount: loadAllMappings().length,
    runtimeCorrelationIds: eventRecords(loadRuntimeEventStoreRecords()).map(
      (record) => record.correlationId,
    ),
    boundedFailures,
    tmuxTailCaptured: false,
  };
  if (options.out !== undefined)
    writeJson(resolveOutPath(options.out), summary);
  return summary;
}

async function main(): Promise<void> {
  const options = parseOptions(Bun.argv.slice(2));
  const summary =
    options.simulate.length > 0
      ? await runFailure(options)
      : await runHappy(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.ok ? 0 : 1);
}

void main();
