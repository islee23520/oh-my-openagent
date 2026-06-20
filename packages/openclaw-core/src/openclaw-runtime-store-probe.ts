import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { dispatchOpenClawEvent } from "./runtime-dispatch"
import { getRuntimeEventStorePath } from "./event-store-paths"
import { loadRuntimeEventStoreRecords, type RuntimeEventStoreRecord } from "./event-store"
import {
  countByKind,
  duplicateCorrelationIds,
  isolatedContextFailures,
  ledgerFailures,
  readerRecordsFromProof,
  readStoreFromRestartedProcess,
  runSequenceFailures,
  writeReaderOutput,
  type RestartProof,
} from "./runtime-store-probe-analysis"
import type { OpenClawConfig } from "./types"

interface ProbeOptions { readonly session: string; readonly events: number; readonly parallel: number; readonly expectNoDuplicates: boolean; readonly expectIsolatedContext: boolean; readonly out: string }
interface ProbeSummary { readonly ok: boolean; readonly session: string; readonly eventsRequested: number; readonly parallel: number; readonly stateDir: string; readonly storePath: string; readonly counts: Record<string, number>; readonly uniqueCorrelationIds: number; readonly duplicateCorrelationIds: readonly string[]; readonly runSequenceFailures: readonly string[]; readonly isolatedContextFailures: readonly string[]; readonly ledgerFailures: readonly string[]; readonly restartProof: RestartProof; readonly records: readonly RuntimeEventStoreRecord[] }

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  if (index === -1) return null
  return args[index + 1] ?? null
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseOptions(args: readonly string[]): ProbeOptions {
  const session = readFlag(args, "--session") ?? "qa-session-runtime-store"
  const out = readFlag(args, "--out")
  if (out === null) {
    throw new Error("--out is required")
  }
  return {
    session,
    events: parsePositiveInt(readFlag(args, "--events"), 1),
    parallel: parsePositiveInt(readFlag(args, "--parallel"), 1),
    expectNoDuplicates: args.includes("--expect-no-duplicates"),
    expectIsolatedContext: args.includes("--expect-isolated-context"),
    out,
  }
}

function createConfig(index: number): OpenClawConfig {
  return {
    enabled: true,
    gateways: { gateway: { type: "command", command: `printf '%s' '{"messageId":"qa-message-${index}","platform":"discord","channelId":"qa-channel-${index}","threadId":"qa-thread-${index}"}'`, timeout: 1000 } },
    hooks: { "session-start": { enabled: true, gateway: "gateway", instruction: "wake" } },
  }
}

function eventRecords(records: readonly RuntimeEventStoreRecord[]) {
  return records.filter((record) => record.kind === "event")
}

function resolveOutPath(out: string): string {
  return isAbsolute(out) ? out : resolve(out === ".omo" || out.startsWith(".omo/") ? join(process.cwd(), "../..", out) : out)
}

async function runProbe(options: ProbeOptions): Promise<ProbeSummary> {
  const stateDir = mkdtempSync(join(tmpdir(), "openclaw-runtime-store-probe-"))
  process.env.XDG_DATA_HOME = stateDir
  const batches = Array.from({ length: options.events }, (_, index) => index + 1)
  for (let offset = 0; offset < batches.length; offset += options.parallel) {
    const batch = batches.slice(offset, offset + options.parallel)
    await Promise.all(
      batch.map((index) =>
        dispatchOpenClawEvent({
          config: createConfig(index),
          rawEvent: "session.created",
          context: { sessionId: options.session, projectPath: `/tmp/openclaw-project-${index}`, tmuxPaneId: `%${index}`, tmuxSession: `tmux-${index}` },
        }),
      ),
    )
  }

  const storePath = getRuntimeEventStorePath()
  const writerRecords = loadRuntimeEventStoreRecords()
  const restartProof = readStoreFromRestartedProcess(stateDir, writerRecords, import.meta.url)
  const records = readerRecordsFromProof(restartProof)
  const duplicateIds = duplicateCorrelationIds(records)
  const sequenceFailures = runSequenceFailures(records)
  const contextFailures = isolatedContextFailures(records)
  const ledgerSemanticFailures = ledgerFailures(records)
  const counts = countByKind(records)
  const ok =
    (counts.session ?? 0) >= options.events
    && (counts.run ?? 0) >= options.events
    && (counts.event ?? 0) >= options.events
    && (counts.ledger ?? 0) >= options.events
    && (!options.expectNoDuplicates || duplicateIds.length === 0)
    && sequenceFailures.length === 0
    && (!options.expectIsolatedContext || contextFailures.length === 0)
    && ledgerSemanticFailures.length === 0
    && restartProof.childExitCode === 0
    && restartProof.sameIds
    && restartProof.sameSequences

  return {
    ok,
    session: options.session,
    eventsRequested: options.events,
    parallel: options.parallel,
    stateDir,
    storePath,
    counts,
    uniqueCorrelationIds: new Set(eventRecords(records).map((record) => record.correlationId)).size,
    duplicateCorrelationIds: duplicateIds,
    runSequenceFailures: sequenceFailures,
    isolatedContextFailures: contextFailures,
    ledgerFailures: ledgerSemanticFailures,
    restartProof,
    records,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const readStoreStateDir = readFlag(args, "--read-store")
  if (readStoreStateDir !== null) return writeReaderOutput(readStoreStateDir)
  const options = parseOptions(args)
  const summary = await runProbe(options)
  const outPath = resolveOutPath(options.out)
  mkdirSync(dirname(outPath), { recursive: true })
  if (options.out.endsWith(".json")) {
    writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`)
  } else {
    writeFileSync(
      outPath,
      [
        `ok=${summary.ok}`,
        `session=${summary.session}`,
        `eventsRequested=${summary.eventsRequested}`,
        `parallel=${summary.parallel}`,
        `storePath=${summary.storePath}`,
        `storeBytes=${readFileSync(summary.storePath, "utf-8").length}`,
        `counts=${JSON.stringify(summary.counts)}`,
        `uniqueCorrelationIds=${summary.uniqueCorrelationIds}`,
        `duplicateCorrelationIds=${summary.duplicateCorrelationIds.join(",")}`,
        `runSequenceFailures=${summary.runSequenceFailures.join(",")}`,
        `isolatedContextFailures=${summary.isolatedContextFailures.join(",")}`,
        `ledgerFailures=${summary.ledgerFailures.join(",")}`,
        `restartChildCommand=${summary.restartProof.childCommand}`,
        `restartChildExitCode=${summary.restartProof.childExitCode}`,
        `restartSameIds=${summary.restartProof.sameIds}`,
        `restartSameSequences=${summary.restartProof.sameSequences}`,
        "",
      ].join("\n"),
    )
  }
  rmSync(summary.stateDir, { recursive: true, force: true })
  if (!summary.ok) process.exit(1)
}

await main()
