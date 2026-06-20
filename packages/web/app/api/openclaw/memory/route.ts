import { NextResponse } from "next/server"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { badOpenClawReadRequest, getQuery } from "@/lib/openclaw-read/http"
import { paginate } from "@/lib/openclaw-read/pagination"

export const runtime = "nodejs"

type MemoryStatus = "active" | "deleted" | "denied"

interface MemoryRecord {
  readonly kind: "memory"
  readonly memoryId: string
  readonly summary: string
  readonly status: MemoryStatus
  readonly pinned: boolean
  readonly sourceSessionId: string
  readonly updatedAt: string
}

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function memoryStorePath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "storage", "openclaw", "memory-governance.jsonl")
}

function redactMemoryText(value: string): string {
  const canary = process.env.OPENCLAW_CANARY_SECRET
  const withoutCanary = canary && canary.length > 0 ? value.split(canary).join("[redacted]") : value
  return withoutCanary
    .replace(/OPENCLAW_[A-Z0-9_]*SECRET[A-Z0-9_]*/g, "[redacted]")
    .replace(/bearer:[A-Za-z0-9._-]+/g, "bearer:[redacted]")
}

function parseMemoryLine(line: string): MemoryRecord | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isRecord(parsed)) return null
    const status = parsed["status"]
    if (parsed["kind"] !== "memory") return null
    if (status !== "active" && status !== "deleted" && status !== "denied") return null
    if (typeof parsed["memoryId"] !== "string" || typeof parsed["summary"] !== "string") return null
    if (typeof parsed["sourceSessionId"] !== "string" || typeof parsed["updatedAt"] !== "string")
      return null
    return {
      kind: "memory",
      memoryId: parsed["memoryId"],
      summary: redactMemoryText(parsed["summary"]),
      status,
      pinned: parsed["pinned"] === true,
      sourceSessionId: parsed["sourceSessionId"],
      updatedAt: parsed["updatedAt"],
    }
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function readMemoryRecords(): readonly Omit<MemoryRecord, "kind">[] {
  if (!existsSync(memoryStorePath())) return []
  const latest = new Map<string, MemoryRecord>()
  for (const line of readFileSync(memoryStorePath(), "utf-8").split("\n")) {
    if (line.trim().length === 0) continue
    const parsed = parseMemoryLine(line)
    if (parsed !== null) latest.set(parsed.memoryId, parsed)
  }
  return Array.from(latest.values())
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map(({ kind: _kind, ...memory }) => memory)
}

export function GET(request: Request): NextResponse {
  try {
    const query = getQuery(request)
    return NextResponse.json(
      paginate(readMemoryRecords(), {
        cursor: query.get("cursor"),
        limit: query.get("limit"),
      }),
    )
  } catch (error) {
    return badOpenClawReadRequest(error)
  }
}
