import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dispatchOpenClawEvent } from "./runtime-dispatch"
import { getRuntimeEventStorePath } from "./event-store-paths"
import { loadRuntimeEventStoreRecords, type RuntimeEventStoreRecord } from "./event-store"
import type { OpenClawConfig } from "./types"

interface ProbeOptions { readonly session: string; readonly events: number; readonly parallel: number; readonly expectNoDuplicates: boolean; readonly expectIsolatedContext: boolean; readonly out: string }
interface ProbeSummary { readonly ok: boolean; readonly session: string; readonly eventsRequested: number; readonly parallel: number; readonly stateDir: string; readonly storePath: string; readonly counts: Record<string, number>; readonly uniqueCorrelationIds: number; readonly duplicateCorrelationIds: readonly string[]; readonly runSequenceFailures: readonly string[]; readonly isolatedContextFailures: readonly string[]; readonly ledgerFailures: readonly string[]; readonly restartProof: RestartProof; readonly records: readonly RuntimeEventStoreRecord[] }
interface StoreIdentity { readonly sessionIds: readonly string[]; readonly runIds: readonly string[]; readonly eventCorrelationIds: readonly string[]; readonly ledgerIds: readonly string[]; readonly eventSequences: readonly string[] }
interface ReaderOutput { readonly stateDir: string; readonly storePath: string; readonly counts: Record<string, number>; readonly identity: StoreIdentity; readonly records: readonly RuntimeEventStoreRecord[] }
interface RestartProof { readonly childCommand: string; readonly childExitCode: number | null; readonly childOutput: string; readonly childErrorOutput: string; readonly childStorePath: string | null; readonly writerIdentity: StoreIdentity; readonly readerIdentity: StoreIdentity | null; readonly sameIds: boolean; readonly sameSequences: boolean }

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

function countByKind(records: readonly RuntimeEventStoreRecord[]): Record<string, number> {
  return records.reduce<Record<string, number>>((counts, record) => {
    counts[record.kind] = (counts[record.kind] ?? 0) + 1
    return counts
  }, {})
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function storeIdentity(records: readonly RuntimeEventStoreRecord[]): StoreIdentity {
  return {
    sessionIds: sorted(records.filter((record) => record.kind === "session").map((record) => record.sessionId)),
    runIds: sorted(records.filter((record) => record.kind === "run").map((record) => record.runId)),
    eventCorrelationIds: sorted(eventRecords(records).map((record) => record.correlationId)),
    ledgerIds: sorted(ledgerRecords(records).map((record) => record.ledgerId)),
    eventSequences: sorted(eventRecords(records).map((record) => `${record.runId}:${record.openclawEvent}:${record.sequence}`)),
  }
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameStoreIds(left: StoreIdentity, right: StoreIdentity): boolean {
  return sameStringList(left.sessionIds, right.sessionIds)
    && sameStringList(left.runIds, right.runIds)
    && sameStringList(left.eventCorrelationIds, right.eventCorrelationIds)
    && sameStringList(left.ledgerIds, right.ledgerIds)
}

function eventRecords(records: readonly RuntimeEventStoreRecord[]) {
  return records.filter((record) => record.kind === "event")
}

function ledgerRecords(records: readonly RuntimeEventStoreRecord[]) {
  return records.filter((record) => record.kind === "ledger")
}

function duplicateCorrelationIds(records: readonly RuntimeEventStoreRecord[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const record of eventRecords(records)) {
    if (seen.has(record.correlationId)) duplicates.add(record.correlationId)
    seen.add(record.correlationId)
  }
  return Array.from(duplicates)
}

function runSequenceFailures(records: readonly RuntimeEventStoreRecord[]): string[] {
  const byRun = new Map<string, number[]>()
  for (const record of eventRecords(records)) {
    byRun.set(record.runId, [...(byRun.get(record.runId) ?? []), record.sequence])
  }
  return Array.from(byRun.entries())
    .filter(([, sequences]) => sequences.some((sequence, index) => sequence !== index + 1))
    .map(([runId, sequences]) => `${runId}:${sequences.join(",")}`)
}

function isolatedContextFailures(records: readonly RuntimeEventStoreRecord[]): string[] {
  return eventRecords(records)
    .filter((record) => {
      const suffix = record.projectPath?.match(/project-(\d+)$/)?.[1]
      return suffix === undefined || record.tmuxPaneId !== `%${suffix}` || record.tmuxSession !== `tmux-${suffix}`
    })
    .map((record) => `${record.runId}:${record.projectPath}:${record.tmuxPaneId}:${record.tmuxSession}`)
}

function ledgerFailures(records: readonly RuntimeEventStoreRecord[]): string[] {
  const ledgers = ledgerRecords(records)
  return eventRecords(records).flatMap((event) => {
    const ledger = ledgers.find((entry) => entry.runId === event.runId && entry.sessionId === event.sessionId && entry.rawEvent === event.rawEvent && entry.openclawEvent === event.openclawEvent)
    if (!ledger) return [`${event.runId}:${event.openclawEvent}:missing-ledger`]
    const expectedStatus = event.success === true ? "success" : "failure"
    const failures: string[] = []
    if (ledger.status !== expectedStatus) failures.push(`${event.runId}:${event.openclawEvent}:status:${ledger.status}:${expectedStatus}`)
    if (!ledger.ledgerId || !ledger.createdAt) failures.push(`${event.runId}:${event.openclawEvent}:missing-ledger-id-or-created-at`)
    if (ledger.projectPath !== event.projectPath || ledger.tmuxPaneId !== event.tmuxPaneId || ledger.tmuxSession !== event.tmuxSession) failures.push(`${event.runId}:${event.openclawEvent}:context-mismatch`)
    if (event.success === true && ledger.messageId !== event.messageId) failures.push(`${event.runId}:${event.openclawEvent}:message-id-mismatch`)
    return failures
  })
}

function resolveOutPath(out: string): string {
  return isAbsolute(out) ? out : resolve(out === ".omo" || out.startsWith(".omo/") ? join(process.cwd(), "../..", out) : out)
}

function readStoreFromRestartedProcess(stateDir: string, writerRecords: readonly RuntimeEventStoreRecord[]): RestartProof {
  const childCommand = [process.execPath, fileURLToPath(import.meta.url), "--read-store", stateDir]
  const child = Bun.spawnSync({ cmd: childCommand, stdout: "pipe", stderr: "pipe" })
  const childOutput = new TextDecoder().decode(child.stdout)
  const childErrorOutput = new TextDecoder().decode(child.stderr)
  const writerIdentity = storeIdentity(writerRecords)
  const reader = child.exitCode === 0 ? parseReaderOutput(childOutput) : null
  const readerIdentity = reader?.identity ?? null
  return {
    childCommand: childCommand.map((part) => JSON.stringify(part)).join(" "),
    childExitCode: child.exitCode,
    childOutput,
    childErrorOutput,
    childStorePath: reader?.storePath ?? null,
    writerIdentity,
    readerIdentity,
    sameIds: readerIdentity !== null && sameStoreIds(writerIdentity, readerIdentity),
    sameSequences: readerIdentity !== null && sameStringList(writerIdentity.eventSequences, readerIdentity.eventSequences),
  }
}

function parseReaderOutput(output: string): ReaderOutput | null {
  try {
    return JSON.parse(output) as ReaderOutput
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function readerRecordsFromProof(proof: RestartProof): readonly RuntimeEventStoreRecord[] {
  const reader = parseReaderOutput(proof.childOutput)
  return reader?.records ?? []
}

function writeReaderOutput(stateDir: string): void {
  process.env.XDG_DATA_HOME = stateDir
  const records = loadRuntimeEventStoreRecords()
  const output: ReaderOutput = { stateDir, storePath: getRuntimeEventStorePath(), counts: countByKind(records), identity: storeIdentity(records), records }
  process.stdout.write(JSON.stringify(output))
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
  const restartProof = readStoreFromRestartedProcess(stateDir, writerRecords)
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
