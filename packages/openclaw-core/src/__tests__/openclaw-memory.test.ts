import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { loadOpenClawPolicyLedgerRecords } from "../policy-ledger"
import {
  applyOpenClawMemoryAction,
  getOpenClawMemoryStorePath,
  readOpenClawMemory,
  seedOpenClawMemory,
} from "../openclaw-memory"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const originalCanary = process.env.OPENCLAW_CANARY_SECRET
const tempDataHome = mkdtempSync(join(tmpdir(), "openclaw-memory-"))

beforeEach(() => {
  process.env.XDG_DATA_HOME = tempDataHome
  process.env.OPENCLAW_CANARY_SECRET = "OPENCLAW_CANARY_SECRET_DO_NOT_LEAK"
  rmSync(dirname(getOpenClawMemoryStorePath()), { recursive: true, force: true })
  mkdirSync(dirname(getOpenClawMemoryStorePath()), { recursive: true })
})

afterAll(() => {
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalXdgDataHome
  if (originalCanary === undefined) delete process.env.OPENCLAW_CANARY_SECRET
  else process.env.OPENCLAW_CANARY_SECRET = originalCanary
  rmSync(tempDataHome, { recursive: true, force: true })
})

describe("OpenClaw memory governance", () => {
  test("redacts canary memory reads", () => {
    // Given: a memory seed contains the configured canary secret.
    seedOpenClawMemory("canary")

    // When: governed memory is read back.
    const body = JSON.stringify(readOpenClawMemory())

    // Then: the raw canary never appears in the exported read surface.
    expect(body.includes("OPENCLAW_CANARY_SECRET_DO_NOT_LEAK")).toBe(false)
    expect(body.includes("[redacted]")).toBe(true)
  })

  test("redacts raw canary records written by older stores", () => {
    // Given: an existing memory store contains a raw canary summary.
    appendFileSync(
      getOpenClawMemoryStorePath(),
      `${JSON.stringify({
        kind: "memory",
        memoryId: "mem-raw-canary",
        summary: "Leaked OPENCLAW_CANARY_SECRET_DO_NOT_LEAK bearer:abc123",
        status: "active",
        pinned: false,
        sourceSessionId: "qa-memory-session",
        updatedAt: "2026-06-20T00:00:00.000Z",
      })}\n`,
    )

    // When: governed memory is read through the public read surface.
    const body = JSON.stringify(readOpenClawMemory())

    // Then: legacy raw secrets are redacted at the read boundary.
    expect(body.includes("OPENCLAW_CANARY_SECRET_DO_NOT_LEAK")).toBe(false)
    expect(body.includes("bearer:abc123")).toBe(false)
    expect(body.includes("[redacted]")).toBe(true)
  })

  test("gates memory mutations and records policy ledger entries", () => {
    // Given: an admin owns a safe memory summary.
    const memory = seedOpenClawMemory("safe-memory")

    // When: the admin pins and edits the memory.
    const pinned = applyOpenClawMemoryAction(memory, "pin", {
      actor: "qa-admin",
      bearerToken: "qa-token",
    })
    const edited = applyOpenClawMemoryAction(pinned.memory, "edit", {
      actor: "qa-admin",
      bearerToken: "qa-token",
    })

    // Then: the state changes and each mutation is represented in the policy ledger.
    expect(pinned).toMatchObject({ ok: true, statusCode: 200, action: "pin" })
    expect(edited.memory).toMatchObject({
      summary: "Updated governed memory summary.",
      pinned: true,
    })
    expect(loadOpenClawPolicyLedgerRecords(memory.sourceSessionId, `${memory.memoryId}:pin`)).toHaveLength(1)
    expect(loadOpenClawPolicyLedgerRecords(memory.sourceSessionId, `${memory.memoryId}:edit`)).toHaveLength(1)
  })

  test("denies reader memory mutation without changing state", () => {
    // Given: a reader token sees a memory summary.
    const memory = seedOpenClawMemory("safe-memory")

    // When: the reader tries to delete it.
    const denied = applyOpenClawMemoryAction(memory, "delete", {
      actor: "qa-reader",
      bearerToken: "qa-reader-token",
    })

    // Then: the mutation is denied and the latest memory remains active.
    expect(denied).toMatchObject({
      ok: false,
      statusCode: 403,
      denialReason: "forbidden",
    })
    expect(readOpenClawMemory()[0]).toMatchObject({ status: "active" })
  })
})
