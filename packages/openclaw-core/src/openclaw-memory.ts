import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { evaluateAndAuditOpenClawPolicy, type OpenClawPolicyStatusCode } from "./openclaw-policy"

export type OpenClawMemoryAction = "pin" | "edit" | "delete" | "deny"
export type OpenClawMemoryStatus = "active" | "deleted" | "denied"

export interface OpenClawMemoryRecord {
  readonly memoryId: string
  readonly summary: string
  readonly status: OpenClawMemoryStatus
  readonly pinned: boolean
  readonly sourceSessionId: string
  readonly updatedAt: string
}

export interface OpenClawMemoryMutationResult {
  readonly ok: boolean
  readonly statusCode: OpenClawPolicyStatusCode
  readonly action: OpenClawMemoryAction
  readonly memory: OpenClawMemoryRecord
  readonly ledgerId: string | null
  readonly denialReason?: string
}

interface MemoryStoreRecord extends OpenClawMemoryRecord {
  readonly kind: "memory"
}

export interface OpenClawMemoryAuth {
  readonly actor: string
  readonly bearerToken?: string
}

function storageDir(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "storage", "openclaw")
}

export function getOpenClawMemoryStorePath(): string {
  return join(storageDir(), "memory-governance.jsonl")
}

function redactMemoryText(value: string): string {
  const canary = process.env.OPENCLAW_CANARY_SECRET
  const withoutCanary = canary && canary.length > 0 ? value.split(canary).join("[redacted]") : value
  return withoutCanary
    .replace(/OPENCLAW_[A-Z0-9_]*SECRET[A-Z0-9_]*/g, "[redacted]")
    .replace(/bearer:[A-Za-z0-9._-]+/g, "bearer:[redacted]")
}

function appendMemory(record: OpenClawMemoryRecord): void {
  mkdirSync(dirname(getOpenClawMemoryStorePath()), { recursive: true, mode: 0o700 })
  appendFileSync(getOpenClawMemoryStorePath(), `${JSON.stringify({ kind: "memory", ...record })}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  })
}

function isMemoryStoreRecord(value: unknown): value is MemoryStoreRecord {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && value.kind === "memory"
    && "memoryId" in value
    && typeof value.memoryId === "string"
    && "summary" in value
    && typeof value.summary === "string"
}

function parseMemoryLine(line: string): MemoryStoreRecord | null {
  try {
    const parsed: unknown = JSON.parse(line)
    return isMemoryStoreRecord(parsed) ? parsed : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function memoryPolicySnapshot(memory: OpenClawMemoryRecord): Readonly<Record<string, unknown>> {
  return {
    memoryId: memory.memoryId,
    summary: memory.summary,
    status: memory.status,
    pinned: memory.pinned,
    sourceSessionId: memory.sourceSessionId,
    updatedAt: memory.updatedAt,
  }
}

function safeMemoryRecord(memory: OpenClawMemoryRecord): OpenClawMemoryRecord {
  return {
    ...memory,
    summary: redactMemoryText(memory.summary),
  }
}

export function readOpenClawMemory(): readonly OpenClawMemoryRecord[] {
  if (!existsSync(getOpenClawMemoryStorePath())) return []
  const latest = new Map<string, OpenClawMemoryRecord>()
  for (const record of readFileSync(getOpenClawMemoryStorePath(), "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseMemoryLine)) {
    if (record === null) continue
    const { kind: _kind, ...memory } = record
    latest.set(memory.memoryId, safeMemoryRecord(memory))
  }
  return Array.from(latest.values()).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

export function seedOpenClawMemory(seed: "safe-memory" | "canary"): OpenClawMemoryRecord {
  const summary = seed === "canary"
    ? `Do not leak ${process.env.OPENCLAW_CANARY_SECRET ?? "OPENCLAW_CANARY_SECRET_DO_NOT_LEAK"}`
    : "Prefers concise operational updates with evidence links."
  const memory: OpenClawMemoryRecord = {
    memoryId: `mem-${randomUUID()}`,
    summary: redactMemoryText(summary),
    status: "active",
    pinned: false,
    sourceSessionId: "qa-memory-session",
    updatedAt: new Date().toISOString(),
  }
  appendMemory(memory)
  return memory
}

export function applyOpenClawMemoryAction(
  memory: OpenClawMemoryRecord,
  action: OpenClawMemoryAction,
  auth: OpenClawMemoryAuth,
): OpenClawMemoryMutationResult {
  const next = nextMemory(memory, action)
  const audit = evaluateAndAuditOpenClawPolicy({
    actor: auth.actor,
    bearerToken: auth.bearerToken,
    action: "approve-run",
    scope: `memory:${action}`,
    sessionId: memory.sourceSessionId,
    runId: `${memory.sourceSessionId}-memory-run`,
    correlationId: `${memory.memoryId}:${action}`,
    targetVersion: 1,
    currentVersion: 1,
    before: memoryPolicySnapshot(memory),
    after: memoryPolicySnapshot(next),
  })
  if (audit.policyResult.decision === "allow") appendMemory(next)
  return {
    ok: audit.policyResult.decision === "allow",
    statusCode: audit.policyResult.statusCode,
    action,
    memory: audit.policyResult.decision === "allow" ? next : memory,
    ledgerId: audit.ledgerRecord?.ledgerId ?? null,
    denialReason: audit.policyResult.denialReason,
  }
}

function nextMemory(memory: OpenClawMemoryRecord, action: OpenClawMemoryAction): OpenClawMemoryRecord {
  const updatedAt = new Date().toISOString()
  switch (action) {
    case "pin":
      return { ...memory, pinned: true, updatedAt }
    case "edit":
      return { ...memory, summary: "Updated governed memory summary.", updatedAt }
    case "delete":
      return { ...memory, summary: "[deleted]", status: "deleted", pinned: false, updatedAt }
    case "deny":
      return { ...memory, summary: "[denied]", status: "denied", pinned: false, updatedAt }
  }
}

export function exportOpenClawMemorySnapshot(): string {
  const payload = JSON.stringify({ data: readOpenClawMemory() }, null, 2)
  const outPath = join(storageDir(), "memory-governance-export.json")
  mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 })
  writeFileSync(outPath, `${payload}\n`, { encoding: "utf-8", mode: 0o600 })
  return payload
}
