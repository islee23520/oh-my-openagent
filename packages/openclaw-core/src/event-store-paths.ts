import { join } from "node:path"
import { getOpenClawStorageDir } from "./session-registry-paths"

export function getRuntimeEventStorePath(): string {
  return join(getOpenClawStorageDir(), "runtime-events.jsonl")
}

export function getRuntimeEventStoreLockPath(): string {
  return join(getOpenClawStorageDir(), "runtime-events.lock")
}
