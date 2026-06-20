import { randomUUID } from "node:crypto"
import {
  constants,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs"
import { dirname } from "node:path"
import {
  LOCK_RETRY_MS,
  LOCK_STALE_MS,
  LOCK_WAIT_TIMEOUT_MS,
  SECURE_FILE_MODE,
} from "./session-registry-paths"
import { getRuntimeEventStoreLockPath, getRuntimeEventStorePath } from "./event-store-paths"

interface RuntimeStoreLock {
  readonly fd: number
  readonly token: string
}

interface RuntimeStoreLockSnapshot {
  readonly raw: string
  readonly pid: number | null
  readonly token: string | null
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function ensureRuntimeStoreDir(): void {
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
    return null
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
    return false
  }
}

function closeLockFd(fd: number): void {
  try {
    closeSync(fd)
  } catch (error) {
    if (error instanceof Error) return
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

export function withRuntimeStoreLock<T>(onLocked: () => T, onLockUnavailable: () => T): T {
  const lock = acquireRuntimeStoreLock()
  if (lock === null) return onLockUnavailable()
  try {
    return onLocked()
  } finally {
    releaseRuntimeStoreLock(lock)
  }
}
