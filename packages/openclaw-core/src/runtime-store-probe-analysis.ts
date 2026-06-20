import { fileURLToPath } from "node:url"
import { getRuntimeEventStorePath } from "./event-store-paths"
import { loadRuntimeEventStoreRecords, type RuntimeEventStoreRecord } from "./event-store"

export interface StoreIdentity {
  readonly sessionIds: readonly string[]
  readonly runIds: readonly string[]
  readonly eventCorrelationIds: readonly string[]
  readonly ledgerIds: readonly string[]
  readonly eventSequences: readonly string[]
}

export interface ReaderOutput {
  readonly stateDir: string
  readonly storePath: string
  readonly counts: Record<string, number>
  readonly identity: StoreIdentity
  readonly records: readonly RuntimeEventStoreRecord[]
}

export interface RestartProof {
  readonly childCommand: string
  readonly childExitCode: number | null
  readonly childOutput: string
  readonly childErrorOutput: string
  readonly childStorePath: string | null
  readonly writerIdentity: StoreIdentity
  readonly readerIdentity: StoreIdentity | null
  readonly sameIds: boolean
  readonly sameSequences: boolean
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function eventRecords(records: readonly RuntimeEventStoreRecord[]) {
  return records.filter((record) => record.kind === "event")
}

function ledgerRecords(records: readonly RuntimeEventStoreRecord[]) {
  return records.filter((record) => record.kind === "ledger")
}

export function countByKind(records: readonly RuntimeEventStoreRecord[]): Record<string, number> {
  return records.reduce<Record<string, number>>((counts, record) => {
    counts[record.kind] = (counts[record.kind] ?? 0) + 1
    return counts
  }, {})
}

export function storeIdentity(records: readonly RuntimeEventStoreRecord[]): StoreIdentity {
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

export function duplicateCorrelationIds(records: readonly RuntimeEventStoreRecord[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const record of eventRecords(records)) {
    if (seen.has(record.correlationId)) duplicates.add(record.correlationId)
    seen.add(record.correlationId)
  }
  return Array.from(duplicates)
}

export function runSequenceFailures(records: readonly RuntimeEventStoreRecord[]): string[] {
  const byRun = new Map<string, number[]>()
  for (const record of eventRecords(records)) {
    byRun.set(record.runId, [...(byRun.get(record.runId) ?? []), record.sequence])
  }
  return Array.from(byRun.entries())
    .filter(([, sequences]) => sequences.some((sequence, index) => sequence !== index + 1))
    .map(([runId, sequences]) => `${runId}:${sequences.join(",")}`)
}

export function isolatedContextFailures(records: readonly RuntimeEventStoreRecord[]): string[] {
  return eventRecords(records)
    .filter((record) => {
      const suffix = record.projectPath?.match(/project-(\d+)$/)?.[1]
      return suffix === undefined || record.tmuxPaneId !== `%${suffix}` || record.tmuxSession !== `tmux-${suffix}`
    })
    .map((record) => `${record.runId}:${record.projectPath}:${record.tmuxPaneId}:${record.tmuxSession}`)
}

export function ledgerFailures(records: readonly RuntimeEventStoreRecord[]): string[] {
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

function parseReaderOutput(output: string): ReaderOutput | null {
  try {
    return JSON.parse(output)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export function readerRecordsFromProof(proof: RestartProof): readonly RuntimeEventStoreRecord[] {
  const reader = parseReaderOutput(proof.childOutput)
  return reader?.records ?? []
}

export function readStoreFromRestartedProcess(stateDir: string, writerRecords: readonly RuntimeEventStoreRecord[], probeUrl: string): RestartProof {
  const childCommand = [process.execPath, fileURLToPath(probeUrl), "--read-store", stateDir]
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

export function writeReaderOutput(stateDir: string): void {
  process.env.XDG_DATA_HOME = stateDir
  const records = loadRuntimeEventStoreRecords()
  const output: ReaderOutput = { stateDir, storePath: getRuntimeEventStorePath(), counts: countByKind(records), identity: storeIdentity(records), records }
  process.stdout.write(JSON.stringify(output))
}
