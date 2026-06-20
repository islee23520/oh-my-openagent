import type {
  ConnectorSummary,
  DashboardData,
  EventSummary,
  LedgerSummary,
  OpenClawHealth,
  PageResult,
  RunSummary,
  SessionSummary,
} from "./openclaw-dashboard-types"
import { cardsFromRuns } from "./openclaw-dashboard-envelopes"

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readArray<T>(value: unknown, item: (input: unknown) => T | null): readonly T[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const parsed = item(entry)
    return parsed === null ? [] : [parsed]
  })
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value : ""
}

function optionalStringField(record: JsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function numberField(record: JsonRecord, key: string): number {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function booleanField(record: JsonRecord, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

function parsePage<T>(value: unknown, item: (input: unknown) => T | null): PageResult<T> {
  if (!isRecord(value)) return { data: [], page: { limit: 0, nextCursor: null, total: 0 } }
  const page = isRecord(value["page"]) ? value["page"] : {}
  const nextCursor = page["nextCursor"]
  return {
    data: readArray(value["data"], item),
    page: {
      limit: numberField(page, "limit"),
      nextCursor: typeof nextCursor === "string" ? nextCursor : null,
      total: numberField(page, "total"),
    },
  }
}

function parseSession(value: unknown): SessionSummary | null {
  if (!isRecord(value)) return null
  const sessionId = stringField(value, "sessionId")
  if (sessionId.length === 0) return null
  const latestEventAt = value["latestEventAt"]
  return {
    kind: "session",
    sessionId,
    createdAt: stringField(value, "createdAt"),
    updatedAt: stringField(value, "updatedAt"),
    runCount: numberField(value, "runCount"),
    eventCount: numberField(value, "eventCount"),
    ledgerCount: numberField(value, "ledgerCount"),
    latestEventAt: typeof latestEventAt === "string" ? latestEventAt : null,
    projectPath: optionalStringField(value, "projectPath"),
    tmuxPaneId: optionalStringField(value, "tmuxPaneId"),
    tmuxSession: optionalStringField(value, "tmuxSession"),
  }
}

function parseRun(value: unknown): RunSummary | null {
  if (!isRecord(value)) return null
  const runId = stringField(value, "runId")
  const sessionId = stringField(value, "sessionId")
  if (runId.length === 0 || sessionId.length === 0) return null
  return {
    kind: "run",
    runId,
    sessionId,
    startedAt: stringField(value, "startedAt"),
    projectPath: optionalStringField(value, "projectPath"),
    tmuxPaneId: optionalStringField(value, "tmuxPaneId"),
    tmuxSession: optionalStringField(value, "tmuxSession"),
  }
}

function parseEvent(value: unknown): EventSummary | null {
  if (!isRecord(value)) return null
  const runId = stringField(value, "runId")
  const sessionId = stringField(value, "sessionId")
  const correlationId = stringField(value, "correlationId")
  if (runId.length === 0 || sessionId.length === 0 || correlationId.length === 0) return null
  return {
    kind: "event",
    runId,
    sessionId,
    openclawEvent: stringField(value, "openclawEvent"),
    sequence: numberField(value, "sequence"),
    correlationId,
    createdAt: stringField(value, "createdAt"),
    gateway: optionalStringField(value, "gateway"),
    success: booleanField(value, "success"),
    messageId: optionalStringField(value, "messageId"),
    platform: optionalStringField(value, "platform"),
  }
}

function parseLedger(value: unknown): LedgerSummary | null {
  if (!isRecord(value)) return null
  const ledgerId = stringField(value, "ledgerId")
  const runId = stringField(value, "runId")
  const sessionId = stringField(value, "sessionId")
  const status = value["status"]
  if (ledgerId.length === 0 || runId.length === 0 || sessionId.length === 0) return null
  if (status !== "success" && status !== "failure") return null
  return {
    kind: "ledger",
    ledgerId,
    runId,
    sessionId,
    openclawEvent: stringField(value, "openclawEvent"),
    status,
    createdAt: stringField(value, "createdAt"),
    gateway: optionalStringField(value, "gateway"),
    messageId: optionalStringField(value, "messageId"),
    platform: optionalStringField(value, "platform"),
    error: optionalStringField(value, "error"),
    statusCode: numberField(value, "statusCode"),
  }
}

function parseConnector(value: unknown): ConnectorSummary | null {
  if (!isRecord(value)) return null
  const connectorId = stringField(value, "connectorId")
  const status = value["status"]
  if (connectorId.length === 0 || (status !== "healthy" && status !== "degraded")) return null
  return {
    connectorId,
    platform: stringField(value, "platform"),
    gateway: stringField(value, "gateway"),
    status,
    eventCount: numberField(value, "eventCount"),
    ledgerCount: numberField(value, "ledgerCount"),
    successCount: numberField(value, "successCount"),
    failureCount: numberField(value, "failureCount"),
    latestSeenAt: stringField(value, "latestSeenAt"),
    source: "runtime-records",
  }
}

function parseHealth(value: unknown): OpenClawHealth {
  const fallback: OpenClawHealth = {
    ok: true,
    store: { recordCount: 0, sessions: 0, runs: 0, events: 0, ledger: 0, connectors: 0 },
  }
  if (!isRecord(value) || !isRecord(value["store"])) return fallback
  const store = value["store"]
  return {
    ok: true,
    store: {
      recordCount: numberField(store, "recordCount"),
      sessions: numberField(store, "sessions"),
      runs: numberField(store, "runs"),
      events: numberField(store, "events"),
      ledger: numberField(store, "ledger"),
      connectors: numberField(store, "connectors"),
    },
  }
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`OpenClaw API returned ${response.status} for ${path}`)
  }
  return response.json()
}

export async function loadOpenClawDashboardData(
  sessionId: string,
  forceApiError: boolean,
  forceInvalidEnvelope: boolean,
): Promise<DashboardData> {
  const query = sessionId.length > 0 ? `?sessionId=${encodeURIComponent(sessionId)}` : ""
  if (forceApiError) {
    await getJson("/api/openclaw/sessions?cursor=bad-cursor")
  }
  const [healthRaw, sessionsRaw, runsRaw, eventsRaw, ledgerRaw, connectorsRaw] = await Promise.all([
    getJson("/api/openclaw/health"),
    getJson(`/api/openclaw/sessions${query}`),
    getJson(`/api/openclaw/runs${query}`),
    getJson(`/api/openclaw/events${query}`),
    getJson(`/api/openclaw/ledger${query}`),
    getJson(`/api/openclaw/connectors${query}`),
  ])
  const ledger = parsePage(ledgerRaw, parseLedger)
  const runs = parsePage(runsRaw, parseRun)
  const envelopeState = cardsFromRuns(runs.data, ledger.data, forceInvalidEnvelope)
  return {
    health: parseHealth(healthRaw),
    sessions: parsePage(sessionsRaw, parseSession),
    runs,
    events: parsePage(eventsRaw, parseEvent),
    ledger,
    connectors: parsePage(connectorsRaw, parseConnector),
    cards: envelopeState.cards,
    invalidEnvelopeMessage: envelopeState.invalidEnvelopeMessage,
  }
}
