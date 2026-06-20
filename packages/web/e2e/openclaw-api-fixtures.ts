import { randomUUID } from "node:crypto"
import { appendFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"

const workspaceRoot = resolve(__dirname, "../../..")
const evidenceDir = join(
  workspaceRoot,
  ".omo/evidence/openclaw-control-plane/issues-9-11-api-envelopes",
)
const secretRawEvent = "prompt: OPENCLAW_SECRET_DO_NOT_LEAK"

export interface SeededRuntimeStore {
  readonly firstRunId: string
  readonly secondRunId: string
}

class MissingDataHomeError extends Error {
  constructor() {
    super("XDG_DATA_HOME is required for OpenClaw API e2e fixtures")
    this.name = "MissingDataHomeError"
  }
}

function dataHome(): string {
  const value = process.env.XDG_DATA_HOME
  if (value === undefined || value.length === 0) {
    throw new MissingDataHomeError()
  }
  return value
}

export function runtimeStorePath(): string {
  return join(dataHome(), "opencode/storage/openclaw/runtime-events.jsonl")
}

export function seedRuntimeStore(sessionId: string): SeededRuntimeStore {
  mkdirSync(evidenceDir, { recursive: true })
  const openClawStorageDir = join(dataHome(), "opencode/storage/openclaw")
  mkdirSync(openClawStorageDir, { recursive: true })
  const firstTimestamp = new Date("2026-06-20T00:00:00.000Z").toISOString()
  const secondTimestamp = new Date("2026-06-20T00:01:00.000Z").toISOString()
  const firstRunId = randomUUID()
  const secondRunId = randomUUID()
  const runtimeContext = {
    projectPath: "/tmp/openclaw-api-project",
    tmuxPaneId: "%9",
    tmuxSession: "qa-openclaw-api",
  }
  const records = [
    {
      kind: "session",
      sessionId,
      ...runtimeContext,
      createdAt: firstTimestamp,
      updatedAt: secondTimestamp,
    },
    {
      kind: "run",
      runId: firstRunId,
      sessionId,
      rawEvent: secretRawEvent,
      ...runtimeContext,
      startedAt: firstTimestamp,
    },
    {
      kind: "run",
      runId: secondRunId,
      sessionId,
      rawEvent: secretRawEvent,
      ...runtimeContext,
      startedAt: secondTimestamp,
    },
    {
      kind: "event",
      runId: firstRunId,
      sessionId,
      rawEvent: secretRawEvent,
      openclawEvent: "session-start",
      sequence: 1,
      correlationId: randomUUID(),
      ...runtimeContext,
      createdAt: firstTimestamp,
      gateway: "gateway",
      success: true,
      messageId: `message-${sessionId}`,
      platform: "discord",
    },
    {
      kind: "event",
      runId: secondRunId,
      sessionId,
      rawEvent: secretRawEvent,
      openclawEvent: "turn-complete",
      sequence: 1,
      correlationId: randomUUID(),
      ...runtimeContext,
      createdAt: secondTimestamp,
      gateway: "gateway",
      success: true,
      messageId: `message-${sessionId}-2`,
      platform: "discord",
    },
    {
      kind: "ledger",
      ledgerId: randomUUID(),
      runId: firstRunId,
      sessionId,
      rawEvent: secretRawEvent,
      openclawEvent: "session-start",
      status: "success",
      ...runtimeContext,
      createdAt: firstTimestamp,
      gateway: "gateway",
      messageId: `message-${sessionId}`,
      platform: "discord",
    },
  ]
  appendFileSync(
    runtimeStorePath(),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf-8",
  )
  return { firstRunId, secondRunId }
}
