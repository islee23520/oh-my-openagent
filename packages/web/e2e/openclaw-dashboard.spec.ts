import { randomUUID } from "node:crypto"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { expect, test, type APIResponse, type Page } from "@playwright/test"

const workspaceRoot = resolve(__dirname, "../../..")
const evidenceDir = join(
  workspaceRoot,
  ".omo/evidence/openclaw-control-plane/issues-10-12-13-governance",
)
const defaultDesktopScreenshot = join(evidenceDir, "issue-10-dashboard-desktop.png")
const defaultMobileScreenshot = join(evidenceDir, "issue-10-dashboard-mobile.png")
const defaultApiArtifact = join(evidenceDir, "issue-10-dashboard-api.json")

interface SessionResponse {
  readonly data: readonly {
    readonly sessionId: string
    readonly runCount: number
    readonly eventCount: number
  }[]
}

interface RunResponse {
  readonly data: readonly { readonly runId: string; readonly sessionId: string }[]
}

interface EventResponse {
  readonly data: readonly {
    readonly correlationId: string
    readonly runId: string
    readonly sessionId: string
  }[]
}

function dataHome(): string {
  const value = process.env.XDG_DATA_HOME
  expect(value).toBeTruthy()
  return value ?? ""
}

function evidencePath(value: string | undefined, fallback: string): string {
  if (value === undefined || value.length === 0) return fallback
  return value === ".omo" || value.startsWith(".omo/") ? join(workspaceRoot, value) : resolve(value)
}

function writeArtifact(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function storePath(): string {
  return join(dataHome(), "opencode/storage/openclaw/runtime-events.jsonl")
}

function seedRuntime(sessionId: string): {
  readonly firstRunId: string
  readonly secondRunId: string
  readonly eventIds: readonly string[]
} {
  const firstRunId = randomUUID()
  const secondRunId = randomUUID()
  const firstEventId = randomUUID()
  const secondEventId = randomUUID()
  const runtimeDir = dirname(storePath())
  mkdirSync(runtimeDir, { recursive: true })
  const firstTimestamp = "2026-06-20T10:00:00.000Z"
  const secondTimestamp = "2026-06-20T10:02:00.000Z"
  const context = {
    projectPath: "/tmp/openclaw-dashboard-project",
    tmuxPaneId: "%10",
    tmuxSession: "qa-openclaw-dashboard",
  }
  const records = [
    {
      kind: "session",
      sessionId,
      ...context,
      createdAt: firstTimestamp,
      updatedAt: secondTimestamp,
    },
    {
      kind: "run",
      runId: firstRunId,
      sessionId,
      rawEvent: "session.created",
      ...context,
      startedAt: firstTimestamp,
    },
    {
      kind: "run",
      runId: secondRunId,
      sessionId,
      rawEvent: "turn.complete",
      ...context,
      startedAt: secondTimestamp,
    },
    {
      kind: "event",
      runId: firstRunId,
      sessionId,
      rawEvent: "session.created",
      openclawEvent: "session.created",
      sequence: 1,
      correlationId: firstEventId,
      ...context,
      createdAt: firstTimestamp,
      gateway: "dashboard-gateway",
      success: true,
      messageId: `message-${sessionId}-1`,
      platform: "discord",
    },
    {
      kind: "event",
      runId: secondRunId,
      sessionId,
      rawEvent: "turn.complete",
      openclawEvent: "turn.complete",
      sequence: 1,
      correlationId: secondEventId,
      ...context,
      createdAt: secondTimestamp,
      gateway: "dashboard-gateway",
      success: true,
      messageId: `message-${sessionId}-2`,
      platform: "discord",
    },
    {
      kind: "ledger",
      ledgerId: randomUUID(),
      runId: firstRunId,
      sessionId,
      rawEvent: "session.created",
      openclawEvent: "session.created",
      status: "success",
      ...context,
      createdAt: firstTimestamp,
      gateway: "dashboard-gateway",
      messageId: `message-${sessionId}-1`,
      platform: "discord",
    },
  ]
  appendFileSync(
    storePath(),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf-8",
  )
  return { firstRunId, secondRunId, eventIds: [firstEventId, secondEventId] }
}

async function jsonBody(response: APIResponse): Promise<unknown> {
  return response.json()
}

function isSessionResponse(value: unknown): value is SessionResponse {
  return typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)
}

function isRunResponse(value: unknown): value is RunResponse {
  return typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)
}

function isEventResponse(value: unknown): value is EventResponse {
  return typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))
  expect(result.docWidth - result.viewportWidth, JSON.stringify(result)).toBeLessThanOrEqual(1)
}

test.describe("OpenClaw dashboard", () => {
  test.describe.configure({ mode: "serial" })

  test("renders seeded runtime records and screenshots the same IDs as the API", async ({
    page,
    request,
  }) => {
    const sessionId = process.env.OPENCLAW_EXPECT_SESSION ?? "qa-session-10"
    const seeded = seedRuntime(sessionId)
    const apiResponse = await request.get(`/api/openclaw/sessions?sessionId=${sessionId}`)
    await expect(apiResponse).toBeOK()
    const sessionsBody = await jsonBody(apiResponse)
    if (!isSessionResponse(sessionsBody))
      throw new Error("OpenClaw sessions response shape changed")
    writeArtifact(
      evidencePath(process.env.OPENCLAW_DASHBOARD_API_JSON, defaultApiArtifact),
      JSON.stringify(sessionsBody, null, 2),
    )

    const runsResponse = await request.get(`/api/openclaw/runs?sessionId=${sessionId}`)
    const eventsResponse = await request.get(`/api/openclaw/events?sessionId=${sessionId}`)
    const runsBody = await jsonBody(runsResponse)
    const eventsBody = await jsonBody(eventsResponse)
    if (!isRunResponse(runsBody)) throw new Error("OpenClaw runs response shape changed")
    if (!isEventResponse(eventsBody)) throw new Error("OpenClaw events response shape changed")

    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/en/openclaw?sessionId=${sessionId}`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("openclaw-dashboard-ready")).toBeVisible()
    await expect(page.getByTestId(`session-${sessionId}`)).toBeVisible()
    await expect(page.getByTestId(`run-${seeded.secondRunId}`)).toBeVisible()
    await expect(page.getByTestId(`event-${seeded.eventIds[1]}`)).toBeVisible()
    await expect(page.getByTestId("card-RUN_STATUS_CARD").first()).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await page.screenshot({
      path: evidencePath(process.env.OPENCLAW_SCREENSHOT_DESKTOP, defaultDesktopScreenshot),
      fullPage: true,
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/en/openclaw?sessionId=${sessionId}`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId(`session-${sessionId}`)).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await page.screenshot({
      path: evidencePath(process.env.OPENCLAW_SCREENSHOT_MOBILE, defaultMobileScreenshot),
      fullPage: true,
    })

    expect(runsBody.data.some((run) => run.runId === seeded.secondRunId)).toBe(true)
    expect(eventsBody.data.some((event) => event.correlationId === seeded.eventIds[1])).toBe(true)
  })

  test("renders empty, loading, and invalid-envelope states", async ({ page }) => {
    const emptySessionId = "qa-session-10-empty"
    await page.goto(`/en/openclaw?sessionId=${emptySessionId}`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("openclaw-empty")).toBeVisible()

    await page.route("**/api/openclaw/sessions**", async (route) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
      await route.continue()
    })
    await page.goto(`/en/openclaw?sessionId=${emptySessionId}`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("openclaw-loading")).toBeVisible()

    const invalidSessionId = "qa-session-10-invalid"
    seedRuntime(invalidSessionId)
    await page.unroute("**/api/openclaw/sessions**")
    await page.goto(`/en/openclaw?sessionId=${invalidSessionId}&invalidEnvelope=1`, {
      waitUntil: "domcontentloaded",
    })
    await expect(page.getByTestId("openclaw-invalid-envelope")).toBeVisible()
  })
})
