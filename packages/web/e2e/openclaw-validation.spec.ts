import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { expect, test } from "@playwright/test"

const workspaceRoot = resolve(__dirname, "../../..")
const evidenceDir = join(workspaceRoot, ".omo/evidence/openclaw-control-plane/issue-14-validation")
const screenshotPath = join(evidenceDir, "dashboard-validation.png")
const apiPath = join(evidenceDir, "dashboard-api.json")

function dataHome(): string {
  const value = process.env.XDG_DATA_HOME
  expect(value).toBeTruthy()
  return value ?? ""
}

function writeArtifact(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function seedRuntime(): {
  readonly sessionId: string
  readonly runId: string
  readonly correlationId: string
} {
  const sessionId = "qa-session-14-dashboard"
  const runId = "run-qa-session-14-dashboard"
  const correlationId = "corr-qa-session-14-dashboard"
  const storePath = join(dataHome(), "opencode/storage/openclaw/runtime-events.jsonl")
  mkdirSync(dirname(storePath), { recursive: true })
  const context = {
    projectPath: "/tmp/openclaw-validation-project",
    tmuxPaneId: "%14",
    tmuxSession: "ulw-qa-openclaw-14",
  }
  const records = [
    {
      kind: "session",
      sessionId,
      ...context,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:01:00.000Z",
    },
    {
      kind: "run",
      runId,
      sessionId,
      rawEvent: "session.created",
      ...context,
      startedAt: "2026-06-20T00:00:00.000Z",
    },
    {
      kind: "event",
      runId,
      sessionId,
      rawEvent: "session.created",
      openclawEvent: "session.created",
      sequence: 1,
      correlationId,
      ...context,
      createdAt: "2026-06-20T00:00:01.000Z",
      gateway: "validation-gateway",
      success: true,
      messageId: "message-qa-session-14",
      platform: "discord",
    },
    {
      kind: "ledger",
      ledgerId: "ledger-qa-session-14-dashboard",
      runId,
      sessionId,
      rawEvent: "session.created",
      openclawEvent: "session.created",
      status: "success",
      ...context,
      createdAt: "2026-06-20T00:00:01.000Z",
      gateway: "validation-gateway",
      messageId: "message-qa-session-14",
      platform: "discord",
    },
  ]
  appendFileSync(
    storePath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf-8",
  )
  return { sessionId, runId, correlationId }
}

test("OpenClaw validation records appear in API and dashboard", async ({ page, request }) => {
  const seeded = seedRuntime()
  const api = await request.get(`/api/openclaw/events?sessionId=${seeded.sessionId}`)
  await expect(api).toBeOK()
  const apiBody = await api.text()
  writeArtifact(apiPath, apiBody)
  expect(apiBody.includes(seeded.correlationId)).toBe(true)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/en/openclaw?sessionId=${seeded.sessionId}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("openclaw-dashboard-ready")).toBeVisible()
  await expect(page.getByTestId(`session-${seeded.sessionId}`)).toBeVisible()
  await expect(page.getByTestId(`run-${seeded.runId}`)).toBeVisible()
  await expect(page.getByTestId(`event-${seeded.correlationId}`)).toBeVisible()
  await page.screenshot({ path: screenshotPath, fullPage: true })
})
