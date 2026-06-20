import { randomUUID } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test, expect } from "@playwright/test"

const workspaceRoot = resolve(__dirname, "../../..")
const evidenceDir = join(workspaceRoot, ".omo/evidence/openclaw-control-plane/issues-9-11-api-envelopes")
const secretRawEvent = "prompt: OPENCLAW_SECRET_DO_NOT_LEAK"

interface SessionsBody {
  readonly data: ReadonlyArray<{
    readonly sessionId: string
    readonly runCount: number
    readonly eventCount: number
    readonly ledgerCount: number
  }>
}

interface RunsBody {
  readonly data: ReadonlyArray<{ readonly runId: string; readonly sessionId: string; readonly rawEvent?: string }>
}

interface EventsBody {
  readonly data: ReadonlyArray<{
    readonly runId: string
    readonly sessionId: string
    readonly rawEvent?: string
    readonly openclawEvent: string
    readonly sequence: number
  }>
  readonly page: { readonly nextCursor: string | null }
}

interface LedgerBody {
  readonly data: ReadonlyArray<{
    readonly ledgerId: string
    readonly runId: string
    readonly sessionId: string
    readonly rawEvent?: string
    readonly openclawEvent: string
    readonly status: "success" | "failure"
  }>
  readonly page: { readonly nextCursor: string | null }
}

interface ConnectorsBody {
  readonly data: ReadonlyArray<{
    readonly connectorId: string
    readonly platform: string
    readonly gateway: string
    readonly status: "healthy" | "degraded"
    readonly eventCount: number
    readonly ledgerCount: number
    readonly source: "runtime-records"
  }>
}

interface SeededRuntimeStore { readonly firstRunId: string; readonly secondRunId: string }

function seedRuntimeStore(sessionId: string): SeededRuntimeStore {
  mkdirSync(evidenceDir, { recursive: true })
  const dataHome = process.env.XDG_DATA_HOME
  expect(dataHome).toBeTruthy()
  const storePath = join(dataHome ?? "", "opencode/storage/openclaw/runtime-events.jsonl")
  mkdirSync(join(dataHome ?? "", "opencode/storage/openclaw"), { recursive: true })
  const firstTimestamp = new Date("2026-06-20T00:00:00.000Z").toISOString()
  const secondTimestamp = new Date("2026-06-20T00:01:00.000Z").toISOString()
  const firstRunId = randomUUID()
  const secondRunId = randomUUID()
  const runtimeContext = { projectPath: "/tmp/openclaw-api-project", tmuxPaneId: "%9", tmuxSession: "qa-openclaw-api" }
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
  appendFileSync(storePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf-8")
  return { firstRunId, secondRunId }
}

function runtimeStorePath(): string {
  const dataHome = process.env.XDG_DATA_HOME
  expect(dataHome).toBeTruthy()
  return join(dataHome ?? "", "opencode/storage/openclaw/runtime-events.jsonl")
}

test.describe("OpenClaw read API", () => {
  test.describe.configure({ mode: "serial" })

  test("returns empty collections when the runtime store has no matching session", async ({ request }) => {
    // given
    const sessionId = "qa-session-9-empty"

    // when
    const sessions = await request.get(`/api/openclaw/sessions?sessionId=${sessionId}`)
    const runs = await request.get(`/api/openclaw/runs?sessionId=${sessionId}`)
    const events = await request.get(`/api/openclaw/events?sessionId=${sessionId}`)
    const ledger = await request.get(`/api/openclaw/ledger?sessionId=${sessionId}`)
    const connectors = await request.get(`/api/openclaw/connectors?sessionId=${sessionId}`)

    // then
    await expect(sessions).toBeOK()
    await expect(runs).toBeOK()
    await expect(events).toBeOK()
    await expect(ledger).toBeOK()
    await expect(connectors).toBeOK()
    await expect((await sessions.json()) as SessionsBody).toMatchObject({ data: [] })
    await expect((await runs.json()) as RunsBody).toMatchObject({ data: [] })
    await expect((await events.json()) as EventsBody).toMatchObject({ data: [] })
    await expect((await ledger.json()) as LedgerBody).toMatchObject({ data: [] })
    await expect((await connectors.json()) as ConnectorsBody).toMatchObject({ data: [] })
  })

  test("returns sessions and related read models when the runtime store contains a session", async ({
    request,
  }) => {
    // given
    const sessionId = "qa-session-9-test"
    const seeded = seedRuntimeStore(sessionId)

    // when
    const sessions = await request.get(`/api/openclaw/sessions?sessionId=${sessionId}`)
    const runs = await request.get(`/api/openclaw/runs?sessionId=${sessionId}`)
    const events = await request.get(`/api/openclaw/events?sessionId=${sessionId}`)
    const ledger = await request.get(`/api/openclaw/ledger?sessionId=${sessionId}`)
    const connectors = await request.get(`/api/openclaw/connectors?sessionId=${sessionId}`)
    const pagedEvents = await request.get(`/api/openclaw/events?sessionId=${sessionId}&limit=1`)
    const nextEvents = await request.get(`/api/openclaw/events?sessionId=${sessionId}&limit=1&cursor=1`)
    const filteredRun = await request.get(`/api/openclaw/runs?sessionId=${sessionId}&runId=${seeded.firstRunId}`)
    const filteredEvent = await request.get(`/api/openclaw/events?sessionId=${sessionId}&openclawEvent=turn-complete`)
    const filteredLedger = await request.get(`/api/openclaw/ledger?sessionId=${sessionId}&status=success`)
    const filteredConnector = await request.get(`/api/openclaw/connectors?sessionId=${sessionId}&platform=discord`)
    const health = await request.get("/api/openclaw/health")

    // then
    await expect(sessions).toBeOK()
    await expect(runs).toBeOK()
    await expect(events).toBeOK()
    await expect(ledger).toBeOK()
    await expect(connectors).toBeOK()
    await expect(pagedEvents).toBeOK()
    await expect(nextEvents).toBeOK()
    await expect(filteredRun).toBeOK()
    await expect(filteredEvent).toBeOK()
    await expect(filteredLedger).toBeOK()
    await expect(filteredConnector).toBeOK()
    await expect(health).toBeOK()
    const sessionsBody: SessionsBody = await sessions.json()
    const runsBody: RunsBody = await runs.json()
    const eventsBody: EventsBody = await events.json()
    const ledgerBody: LedgerBody = await ledger.json()
    const connectorsBody: ConnectorsBody = await connectors.json()
    const pagedEventsBody: EventsBody = await pagedEvents.json()
    const nextEventsBody: EventsBody = await nextEvents.json()
    const filteredRunBody: RunsBody = await filteredRun.json()
    const filteredEventBody: EventsBody = await filteredEvent.json()
    const filteredLedgerBody: LedgerBody = await filteredLedger.json()
    const filteredConnectorBody: ConnectorsBody = await filteredConnector.json()
    expect(sessionsBody.data[0]?.sessionId).toBe(sessionId)
    expect(sessionsBody.data[0]?.runCount).toBeGreaterThanOrEqual(2)
    expect(sessionsBody.data[0]?.eventCount).toBeGreaterThanOrEqual(2)
    expect(sessionsBody.data[0]?.ledgerCount).toBeGreaterThanOrEqual(1)
    expect(runsBody.data[0]?.sessionId).toBe(sessionId)
    expect(runsBody.data[0]?.runId).toBe(seeded.secondRunId)
    expect(runsBody.data.some((run) => run.rawEvent?.includes("OPENCLAW_SECRET_DO_NOT_LEAK") === true)).toBe(false)
    expect(eventsBody.data[0]?.sessionId).toBe(sessionId)
    expect(eventsBody.data[0]?.runId).toBe(seeded.secondRunId)
    expect(eventsBody.data[0]?.openclawEvent).toBe("turn-complete")
    expect(eventsBody.page.nextCursor).toBe(null)
    expect(eventsBody.data.some((event) => event.rawEvent?.includes("OPENCLAW_SECRET_DO_NOT_LEAK") === true)).toBe(false)
    expect(ledgerBody.data[0]?.sessionId).toBe(sessionId)
    expect(ledgerBody.data[0]?.runId).toBe(seeded.firstRunId)
    expect(ledgerBody.data[0]?.openclawEvent).toBe("session-start")
    expect(ledgerBody.data[0]?.status).toBe("success")
    expect(ledgerBody.data.some((entry) => entry.rawEvent?.includes("OPENCLAW_SECRET_DO_NOT_LEAK") === true)).toBe(false)
    expect(connectorsBody.data[0]).toMatchObject({
      connectorId: "discord:gateway",
      platform: "discord",
      gateway: "gateway",
      status: "healthy",
      eventCount: 2,
      ledgerCount: 1,
      source: "runtime-records",
    })
    expect(pagedEventsBody.data).toHaveLength(1)
    expect(pagedEventsBody.page.nextCursor).toBe("1")
    expect(nextEventsBody.data[0]?.runId).toBe(seeded.firstRunId)
    expect(nextEventsBody.page.nextCursor).toBe(null)
    expect(filteredRunBody.data).toHaveLength(1)
    expect(filteredRunBody.data[0]?.runId).toBe(seeded.firstRunId)
    expect(filteredEventBody.data).toHaveLength(1)
    expect(filteredEventBody.data[0]?.openclawEvent).toBe("turn-complete")
    expect(filteredLedgerBody.data).toHaveLength(1)
    expect(filteredLedgerBody.data[0]?.status).toBe("success")
    expect(filteredConnectorBody.data).toHaveLength(1)
    expect(filteredConnectorBody.data[0]?.connectorId).toBe("discord:gateway")
  })

  test("rejects an invalid cursor without mutating the runtime store", async ({ request }) => {
    // given
    const sessionId = "qa-session-9-invalid"
    seedRuntimeStore(sessionId)
    const storePath = runtimeStorePath()
    const before = readFileSync(storePath, "utf-8")

    // when
    const response = await request.get(`/api/openclaw/events?sessionId=${sessionId}&cursor=bad-cursor`)

    // then
    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "invalid_cursor" } })
    expect(readFileSync(storePath, "utf-8")).toBe(before)
  })
})
