import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface ProbeOptions {
  readonly fakeGatewayPort: number;
  readonly session: string;
  readonly events: readonly string[];
  readonly outDir?: string;
  readonly out?: string;
  readonly expectListenerPayload: boolean;
  readonly expectSessionRegisterRemove: boolean;
  readonly expectTmuxTail: boolean;
  readonly simulate: readonly string[];
}

export interface CapturedGatewayPayload {
  readonly event?: string;
  readonly sessionId?: string;
  readonly tmuxTail?: string;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function parseOptions(args: readonly string[]): ProbeOptions {
  return {
    fakeGatewayPort: Number.parseInt(
      readFlag(args, "--fake-gateway-port") ?? "43114",
      10,
    ),
    session: readFlag(args, "--session") ?? "qa-session-14",
    events: (
      readFlag(args, "--events") ?? "session.created,stop,session.deleted"
    ).split(","),
    outDir: readFlag(args, "--out-dir"),
    out: readFlag(args, "--out"),
    expectListenerPayload: args.includes("--expect-listener-payload"),
    expectSessionRegisterRemove: args.includes(
      "--expect-session-register-remove",
    ),
    expectTmuxTail: args.includes("--expect-tmux-tail"),
    simulate: args.flatMap((arg, index) =>
      arg === "--simulate" ? [args[index + 1] ?? ""] : [],
    ),
  };
}

export function resolveOutPath(out: string): string {
  return isAbsolute(out)
    ? out
    : resolve(
        out === ".omo" || out.startsWith(".omo/")
          ? join(process.cwd(), "../..", out)
          : out,
      );
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function payloadFromUnknown(value: unknown): CapturedGatewayPayload {
  if (!isRecord(value)) return {};
  return {
    event: typeof value["event"] === "string" ? value["event"] : undefined,
    sessionId:
      typeof value["sessionId"] === "string" ? value["sessionId"] : undefined,
    tmuxTail:
      typeof value["tmuxTail"] === "string" ? value["tmuxTail"] : undefined,
  };
}
