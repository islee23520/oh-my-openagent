import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type {
  RuntimeEventRecord,
  RuntimeEventStoreRecord,
  RuntimeLedgerEntryRecord,
  RuntimeRecordKind,
  RuntimeRunRecord,
  RuntimeSessionRecord,
} from "./types"

const SECURE_FILE_MODE = 0o600
const LOCK_WAIT_TIMEOUT_MS = 4000
const LOCK_RETRY_MS = 20
const LOCK_STALE_MS = 10000

interface RuntimeStoreLock {
  readonly fd: number
  readonly token: string
}

interface RuntimeStoreLockSnapshot {
  readonly raw: string
  readonly pid: number | null
  readonly token: string | null
}

function isRuntimeRecordKind(kind: unknown): kind is RuntimeRecordKind {
  return kind === "session" || kind === "run" || kind === "event" || kind === "ledger"
}

function isRuntimeStoreRecord(record: unknown): record is RuntimeEventStoreRecord {
  if (typeof record !== "object" || record === null) return false
  if (!("kind" in record) || !isRuntimeRecordKind(record.kind)) return false
  if (!("sessionId" in record) || typeof record.sessionId !== "string") return false
  return true
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function getOpenCodeStorageDir(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "storage")
}

function getRuntimeEventStorePath(): string {
  return join(getOpenCodeStorageDir(), "openclaw", "runtime-events.jsonl")
}

function getRuntimeEventStoreLockPath(): string {
  return join(getOpenCodeStorageDir(), "openclaw", "runtime-events.lock")
}

function ensureRuntimeStoreDir(): void {
  const runtimeStoreDir = dirname(getRuntimeEventStorePath())
  if (!existsSync(runtimeStoreDir)) {
    mkdirSync(runtimeStoreDir, { recursive: true, mode: 0o700 })
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      return error.code === "EPERM"
    }
    return false
  }
}

function readLockSnapshot(): RuntimeStoreLockSnapshot | null {
  try {
    const lockPath = getRuntimeEventStoreLockPath()
    if (!existsSync(lockPath)) return null
    const raw = readFileSync(lockPath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return { raw, pid: null, token: null }
    const pid = "pid" in parsed && typeof parsed.pid === "number" ? parsed.pid : null
    const token = "token" in parsed && typeof parsed.token === "string" ? parsed.token : null
    return { raw, pid, token }
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function removeLockIfUnchanged(snapshot: RuntimeStoreLockSnapshot): boolean {
  try {
    const lockPath = getRuntimeEventStoreLockPath()
    if (!existsSync(lockPath)) return false
    if (readFileSync(lockPath, "utf-8") !== snapshot.raw) return false
    unlinkSync(lockPath)
    return true
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

function closeLockFd(fd: number): void {
  try {
    closeSync(fd)
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}

function acquireRuntimeStoreLock(): RuntimeStoreLock | null {
  ensureRuntimeStoreDir()
  const started = Date.now()
  while (Date.now() - started < LOCK_WAIT_TIMEOUT_MS) {
    try {
      const token = randomUUID()
      const fd = openSync(
        getRuntimeEventStoreLockPath(),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        SECURE_FILE_MODE,
      )
      writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), token }))
      return { fd, token }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error
      if (error.code !== "EEXIST") throw error

      try {
        const lockAgeMs = Date.now() - statSync(getRuntimeEventStoreLockPath()).mtimeMs
        if (lockAgeMs > LOCK_STALE_MS) {
          const snapshot = readLockSnapshot()
          if (snapshot?.pid !== null && snapshot?.pid !== undefined && isPidAlive(snapshot.pid)) {
            sleepMs(LOCK_RETRY_MS)
            continue
          }
          if (snapshot && removeLockIfUnchanged(snapshot)) continue
        }
      } catch (statError) {
        if (!(statError instanceof Error)) throw statError
      }
      sleepMs(LOCK_RETRY_MS)
    }
  }
  return null
}

function releaseRuntimeStoreLock(lock: RuntimeStoreLock): void {
  closeLockFd(lock.fd)
  const snapshot = readLockSnapshot()
  if (!snapshot || snapshot.token !== lock.token) return
  removeLockIfUnchanged(snapshot)
}

function withRuntimeStoreLock<T>(onLocked: () => T, onLockUnavailable: () => T): T {
  const lock = acquireRuntimeStoreLock()
  if (lock === null) return onLockUnavailable()
  try {
    return onLocked()
  } finally {
    releaseRuntimeStoreLock(lock)
  }
}

function parseRuntimeStoreLine(line: string): RuntimeEventStoreRecord | null {
  try {
    const parsed: unknown = JSON.parse(line)
    return isRuntimeStoreRecord(parsed) ? parsed : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function readRecordsUnsafe(): RuntimeEventStoreRecord[] {
  if (!existsSync(getRuntimeEventStorePath())) return []
  return readFileSync(getRuntimeEventStorePath(), "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseRuntimeStoreLine)
    .filter((record): record is RuntimeEventStoreRecord => record !== null)
}

export function runtimeRecords(): readonly RuntimeEventStoreRecord[] {
  return withRuntimeStoreLock(
    () => readRecordsUnsafe(),
    () => [],
  )
}

export function sessionsOf(allRecords: readonly RuntimeEventStoreRecord[]): readonly RuntimeSessionRecord[] {
  return allRecords.filter((record): record is RuntimeSessionRecord => record.kind === "session")
}

export function runsOf(allRecords: readonly RuntimeEventStoreRecord[]): readonly RuntimeRunRecord[] {
  return allRecords.filter((record): record is RuntimeRunRecord => record.kind === "run")
}

export function eventsOf(allRecords: readonly RuntimeEventStoreRecord[]): readonly RuntimeEventRecord[] {
  return allRecords.filter((record): record is RuntimeEventRecord => record.kind === "event")
}

export function ledgerOf(allRecords: readonly RuntimeEventStoreRecord[]): readonly RuntimeLedgerEntryRecord[] {
  return allRecords.filter((record): record is RuntimeLedgerEntryRecord => record.kind === "ledger")
}
