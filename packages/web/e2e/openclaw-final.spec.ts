import { randomUUID } from "node:crypto"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { expect, test, type APIResponse } from "@playwright/test"

const workspaceRoot = resolve(__dirname, "../../..")
const evidenceDir = join(workspaceRoot, ".omo/evidence/openclaw-control-plane/final-merge-loop")
const canary = "OPENCLAW_FINAL_CANARY_SECRET_DO_NOT_LEAK"

interface PageBody<T> {
  readonly data: readonly T[]
}

interface SessionRow {
  readonly sessionId: string
  readonly runCount: number
  readonly eventCount: number
  readonly ledgerCount: number
}

interface ConnectorRow {
  readonly connectorId: string
  readonly status: "healthy" | "degraded"
  readonly failureCount: number
}

class OpenClawShapeError extends Error {
  readonly name = "OpenClawShapeError"
}

function dataHome(): string {
  const value = process.env.XDG_DATA_HOME
  expect(value).toBeTruthy()
  return value ?? ""
}

function storePath(name: string): string {
  return join(dataHome(), "opencode/storage/openclaw", name)
}

function writeArtifact(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function isPageBody<T>(value: unknown, isRow: (row: unknown) => row is T): value is PageBody<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    Array.isArray(value.data) &&
    value.data.every(isRow)
  )
}

function isSessionRow(row: unknown): row is SessionRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "sessionId" in row &&
    typeof row.sessionId === "string"
  )
}

function isConnectorRow(row: unknown): row is ConnectorRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "connectorId" in row &&
    typeof row.connectorId === "string"
  )
}

async function parsedBody<T>(
  response: APIResponse,
  isRow: (row: unknown) => row is T,
): Promise<PageBody<T>> {
  const body: unknown = await response.json()
  if (!isPageBody(body, isRow)) throw new OpenClawShapeError("OpenClaw API response shape changed")
  return body
}

function seedRuntime(sessionId: string): {
  readonly secondRunId: string
  readonly secondCorrelationId: string
  readonly ledgerId: string
} {
  const firstRunId = randomUUID()
  const secondRunId = randomUUID()
  const firstCorrelationId = randomUUID()
  const secondCorrelationId = randomUUID()
  const ledgerId = randomUUID()
  const context = {
    projectPath: "/tmp/openclaw-final-project",
    tmuxPaneId: "%20",
    tmuxSession: "qa-openclaw-final",
  }
  const records = [
    {
      kind: "session",
      sessionId,
      ...context,
      createdAt: "2026-06-20T12:00:00.000Z",
      updatedAt: "2026-06-20T12:02:00.000Z",
    },
    {
      kind: "run",
      runId: firstRunId,
      sessionId,
      rawEvent: `prompt ${canary}`,
      ...context,
      startedAt: "2026-06-20T12:00:00.000Z",
    },
    {
      kind: "run",
      runId: secondRunId,
      sessionId,
      rawEvent: `tool result ${canary}`,
      ...context,
      startedAt: "2026-06-20T12:02:00.000Z",
    },
    {
      kind: "event",
      runId: firstRunId,
      sessionId,
      rawEvent: `created ${canary}`,
      openclawEvent: "session.created",
      sequence: 1,
      correlationId: firstCorrelationId,
      ...context,
      createdAt: "2026-06-20T12:00:01.000Z",
      gateway: "final-gateway",
      success: true,
      messageId: `message-${sessionId}-1`,
      platform: "discord",
    },
    {
      kind: "event",
      runId: secondRunId,
      sessionId,
      rawEvent: `complete ${canary}`,
      openclawEvent: "turn.complete",
      sequence: 1,
      correlationId: secondCorrelationId,
      ...context,
      createdAt: "2026-06-20T12:02:01.000Z",
      gateway: "final-gateway",
      success: false,
      messageId: `message-${sessionId}-2`,
      platform: "discord",
    },
    {
      kind: "ledger",
      ledgerId,
      runId: secondRunId,
      sessionId,
      rawEvent: `policy ${canary}`,
      openclawEvent: "approve-run",
      status: "failure",
      ...context,
      createdAt: "2026-06-20T12:02:02.000Z",
      gateway: "final-gateway",
      messageId: `message-${sessionId}-3`,
      platform: "discord",
      error: "forbidden",
      statusCode: 403,
    },
  ]
  mkdirSync(dirname(storePath("runtime-events.jsonl")), { recursive: true })
  appendFileSync(
    storePath("runtime-events.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  )
  return { secondRunId, secondCorrelationId, ledgerId }
}

function seedMemory(sessionId: string): string {
  const memoryId = "mem-final-canary"
  const record = {
    kind: "memory",
    memoryId,
    summary: `Pinned ${canary} bearer:final-token`,
    status: "active",
    pinned: true,
    sourceSessionId: sessionId,
    updatedAt: "2026-06-20T12:03:00.000Z",
  }
  mkdirSync(dirname(storePath("memory-governance.jsonl")), { recursive: true })
  appendFileSync(storePath("memory-governance.jsonl"), `${JSON.stringify(record)}\n`)
  return memoryId
}

test("OpenClaw final integration correlates API, dashboard, denial, memory, and workload signals", async ({
  page,
  request,
}) => {
  const sessionId = "qa-session-final"
  const seeded = seedRuntime(sessionId)
  const memoryId = seedMemory(sessionId)
  const sessions = await request.get(`/api/openclaw/sessions?sessionId=${sessionId}`)
  const connectors = await request.get(`/api/openclaw/connectors?sessionId=${sessionId}`)
  const memory = await request.get("/api/openclaw/memory")
  const mutation = await request.post("/api/openclaw/memory", { data: { memoryId } })
  await expect(sessions).toBeOK()
  await expect(connectors).toBeOK()
  await expect(memory).toBeOK()
  expect(mutation.status()).toBeGreaterThanOrEqual(400)
  const sessionBody = await parsedBody(sessions, isSessionRow)
  const connectorBody = await parsedBody(connectors, isConnectorRow)
  const memoryText = await memory.text()
  writeArtifact(
    join(evidenceDir, "openclaw-final-api.json"),
    JSON.stringify(
      { sessionBody, connectorBody, mutationStatus: mutation.status(), memoryText },
      null,
      2,
    ),
  )
  expect(sessionBody.data[0]?.sessionId).toBe(sessionId)
  expect(sessionBody.data[0]?.runCount).toBe(2)
  expect(sessionBody.data[0]?.eventCount).toBe(2)
  expect(sessionBody.data[0]?.ledgerCount).toBe(1)
  expect(connectorBody.data[0]?.connectorId).toBe("discord:final-gateway")
  expect(connectorBody.data[0]?.status).toBe("degraded")
  expect(connectorBody.data[0]?.failureCount).toBe(2)
  expect(memoryText.includes(canary)).toBe(false)
  expect(memoryText.includes("bearer:final-token")).toBe(false)
  expect(memoryText.includes("[redacted]")).toBe(true)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/en/openclaw?sessionId=${sessionId}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("openclaw-dashboard-ready")).toBeVisible()
  await expect(page.getByTestId(`session-${sessionId}`)).toBeVisible()
  await expect(page.getByTestId(`run-${seeded.secondRunId}`)).toBeVisible()
  await expect(page.getByTestId(`event-${seeded.secondCorrelationId}`)).toBeVisible()
  await expect(page.getByTestId(`ledger-${seeded.ledgerId}`)).toBeVisible()
  await expect(page.getByTestId("connector-discord:final-gateway")).toBeVisible()
  await expect(page.getByTestId(`memory-${memoryId}`)).toBeVisible()
  const body = await page.locator("body").innerText()
  expect(body.includes(canary)).toBe(false)
  expect(body.includes("bearer:final-token")).toBe(false)
  await page.screenshot({ path: join(evidenceDir, "openclaw-final-dashboard.png"), fullPage: true })
})
