import { randomUUID } from "node:crypto"
import { constants, closeSync, existsSync, openSync, readFileSync, writeSync } from "node:fs"
import { getRuntimeEventStorePath } from "./event-store-paths"
import { ensureRuntimeStoreDir, withRuntimeStoreLock } from "./event-store-lock"
import { SECURE_FILE_MODE } from "./session-registry-paths"
import type { WakeResult } from "./types"

export type RuntimeRecordKind = "session" | "run" | "event" | "ledger"

interface RuntimeContext {
  readonly sessionId?: string
  readonly projectPath?: string
  readonly tmuxPaneId?: string
  readonly tmuxSession?: string
}

export interface RuntimeSessionRecord extends RuntimeContext {
  readonly kind: "session"
  readonly sessionId: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RuntimeRunRecord extends RuntimeContext {
  readonly kind: "run"
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
  readonly startedAt: string
}

export interface RuntimeEventRecord extends RuntimeContext {
  readonly kind: "event"
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
  readonly openclawEvent: string
  readonly sequence: number
  readonly correlationId: string
  readonly createdAt: string
  readonly gateway?: string
  readonly success?: boolean
  readonly messageId?: string
  readonly platform?: string
}

export interface RuntimeLedgerEntryRecord extends RuntimeContext {
  readonly kind: "ledger"
  readonly ledgerId: string
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
  readonly openclawEvent: string
  readonly status: "success" | "failure"
  readonly createdAt: string
  readonly gateway?: string
  readonly messageId?: string
  readonly platform?: string
  readonly error?: string
  readonly statusCode?: number
}

export type LedgerEntry = RuntimeLedgerEntryRecord

export type RuntimeEventStoreRecord =
  | RuntimeSessionRecord
  | RuntimeRunRecord
  | RuntimeEventRecord
  | RuntimeLedgerEntryRecord

export interface RuntimeRunStart extends RuntimeContext {
  readonly rawEvent: string
}

export interface RuntimeRunHandle {
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
}

export interface RuntimeEventAppend extends RuntimeContext {
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
  readonly openclawEvent: string
  readonly result: WakeResult | null
  readonly createdAt?: string
}

function statusFromWakeResult(result: WakeResult | null): RuntimeLedgerEntryRecord["status"] {
  return result?.success === true ? "success" : "failure"
}

function appendRecordsUnsafe(records: readonly RuntimeEventStoreRecord[]): void {
  ensureRuntimeStoreDir()
  const fd = openSync(
    getRuntimeEventStorePath(),
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
    SECURE_FILE_MODE,
  )
  try {
    for (const record of records) {
      writeSync(fd, `${JSON.stringify(record)}\n`)
    }
  } finally {
    closeSync(fd)
  }
}

function isRuntimeEventRecord(value: unknown): value is RuntimeEventRecord {
  if (typeof value !== "object" || value === null) return false
  if (!("kind" in value) || value.kind !== "event") return false
  if (!("runId" in value) || typeof value.runId !== "string") return false
  if (!("sequence" in value) || typeof value.sequence !== "number") return false
  return true
}

function readRecordsUnsafe(): RuntimeEventStoreRecord[] {
  if (!existsSync(getRuntimeEventStorePath())) return []
  return readFileSync(getRuntimeEventStorePath(), "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as RuntimeEventStoreRecord
      } catch (error) {
        if (error instanceof SyntaxError) return null
        return null
      }
    })
    .filter((record): record is RuntimeEventStoreRecord => record !== null)
}

function nextSequenceUnsafe(runId: string): number {
  const existingSequences = readRecordsUnsafe()
    .filter(isRuntimeEventRecord)
    .filter((record) => record.runId === runId)
    .map((record) => record.sequence)
  return existingSequences.length === 0 ? 1 : Math.max(...existingSequences) + 1
}

export function startRuntimeRun(start: RuntimeRunStart): RuntimeRunHandle | null {
  if (!start.sessionId) return null
  const runId = randomUUID()
  const now = new Date().toISOString()
  const sessionRecord: RuntimeSessionRecord = {
    kind: "session",
    sessionId: start.sessionId,
    projectPath: start.projectPath,
    tmuxPaneId: start.tmuxPaneId,
    tmuxSession: start.tmuxSession,
    createdAt: now,
    updatedAt: now,
  }
  const runRecord: RuntimeRunRecord = {
    kind: "run",
    runId,
    sessionId: start.sessionId,
    rawEvent: start.rawEvent,
    projectPath: start.projectPath,
    tmuxPaneId: start.tmuxPaneId,
    tmuxSession: start.tmuxSession,
    startedAt: now,
  }
  const wrote = withRuntimeStoreLock(
    () => {
      appendRecordsUnsafe([sessionRecord, runRecord])
      return true
    },
    () => false,
  )
  return wrote ? { runId, sessionId: start.sessionId, rawEvent: start.rawEvent } : null
}

export function appendRuntimeEvent(event: RuntimeEventAppend): boolean {
  return withRuntimeStoreLock(
    () => {
      const createdAt = event.createdAt ?? new Date().toISOString()
      const eventRecord: RuntimeEventRecord = {
        kind: "event",
        runId: event.runId,
        sessionId: event.sessionId,
        rawEvent: event.rawEvent,
        openclawEvent: event.openclawEvent,
        sequence: nextSequenceUnsafe(event.runId),
        correlationId: randomUUID(),
        projectPath: event.projectPath,
        tmuxPaneId: event.tmuxPaneId,
        tmuxSession: event.tmuxSession,
        createdAt,
        gateway: event.result?.gateway,
        success: event.result?.success,
        messageId: event.result?.messageId,
        platform: event.result?.platform,
      }
      const ledgerRecord: RuntimeLedgerEntryRecord = {
        kind: "ledger",
        ledgerId: randomUUID(),
        runId: event.runId,
        sessionId: event.sessionId,
        rawEvent: event.rawEvent,
        openclawEvent: event.openclawEvent,
        status: statusFromWakeResult(event.result),
        projectPath: event.projectPath,
        tmuxPaneId: event.tmuxPaneId,
        tmuxSession: event.tmuxSession,
        createdAt,
        gateway: event.result?.gateway,
        messageId: event.result?.messageId,
        platform: event.result?.platform,
        error: event.result?.error,
        statusCode: event.result?.statusCode,
      }
      appendRecordsUnsafe([eventRecord, ledgerRecord])
      return true
    },
    () => false,
  )
}

export function appendRuntimeLedgerEntry(entry: RuntimeLedgerEntryRecord): boolean {
  return withRuntimeStoreLock(
    () => {
      appendRecordsUnsafe([entry])
      return true
    },
    () => false,
  )
}

export function loadRuntimeEventStoreRecords(): RuntimeEventStoreRecord[] {
  return withRuntimeStoreLock(
    () => readRecordsUnsafe(),
    () => [],
  )
}
