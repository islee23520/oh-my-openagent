import { paginate } from "./pagination"
import { eventsOf, ledgerOf, runtimeRecords, runsOf, sessionsOf } from "./store"
import type {
  EventQuery,
  EventSummary,
  ConnectorQuery,
  ConnectorSummary,
  LedgerQuery,
  LedgerSummary,
  OpenClawHealth,
  PageResult,
  RunQuery,
  RunSummary,
  RuntimeEventRecord,
  RuntimeEventStoreRecord,
  RuntimeLedgerEntryRecord,
  RuntimeRunRecord,
  SessionQuery,
  SessionSummary,
} from "./types"

export { InvalidCursorError, InvalidLimitError } from "./pagination"

function byNewestSession(left: SessionSummary, right: SessionSummary): number {
  const rightTime = Date.parse(right.latestEventAt ?? right.updatedAt)
  const leftTime = Date.parse(left.latestEventAt ?? left.updatedAt)
  return rightTime - leftTime || left.sessionId.localeCompare(right.sessionId)
}

function byNewestRun(left: RuntimeRunRecord, right: RuntimeRunRecord): number {
  return Date.parse(right.startedAt) - Date.parse(left.startedAt) || left.runId.localeCompare(right.runId)
}

function byNewestEvent(left: RuntimeEventRecord, right: RuntimeEventRecord): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.sequence - left.sequence
}

function byNewestLedger(left: RuntimeLedgerEntryRecord, right: RuntimeLedgerEntryRecord): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.ledgerId.localeCompare(right.ledgerId)
}

function byNewestConnector(left: ConnectorSummary, right: ConnectorSummary): number {
  return Date.parse(right.latestSeenAt) - Date.parse(left.latestSeenAt) || left.connectorId.localeCompare(right.connectorId)
}

export function readOpenClawHealth(): OpenClawHealth {
  const allRecords = runtimeRecords()
  const connectors = readConnectorsFromRecords(allRecords)
  return {
    ok: true,
    store: {
      recordCount: allRecords.length,
      sessions: sessionsOf(allRecords).length,
      runs: runsOf(allRecords).length,
      events: eventsOf(allRecords).length,
      ledger: ledgerOf(allRecords).length,
      connectors: connectors.length,
    },
  }
}

export function readOpenClawSessions(query: SessionQuery): PageResult<SessionSummary> {
  const allRecords = runtimeRecords()
  const runs = runsOf(allRecords)
  const events = eventsOf(allRecords)
  const ledger = ledgerOf(allRecords)
  const latestBySession = new Map<string, SessionSummary>()

  for (const session of sessionsOf(allRecords)) {
    if (query.sessionId !== null && session.sessionId !== query.sessionId) continue
    const sessionRuns = runs.filter((run) => run.sessionId === session.sessionId)
    const sessionEvents = events.filter((event) => event.sessionId === session.sessionId)
    const summary: SessionSummary = {
      ...session,
      runCount: sessionRuns.length,
      eventCount: sessionEvents.length,
      ledgerCount: ledger.filter((entry) => entry.sessionId === session.sessionId).length,
      latestEventAt: latestEventAt(sessionEvents),
    }
    const existing = latestBySession.get(session.sessionId)
    if (existing === undefined || byNewestSession(summary, existing) < 0) {
      latestBySession.set(session.sessionId, summary)
    }
  }

  return paginate(Array.from(latestBySession.values()).sort(byNewestSession), query)
}

function latestEventAt(events: readonly RuntimeEventRecord[]): string | null {
  return events.reduce<string | null>((latest, event) => {
    if (latest === null) return event.createdAt
    return Date.parse(event.createdAt) > Date.parse(latest) ? event.createdAt : latest
  }, null)
}

export function readOpenClawRuns(query: RunQuery): PageResult<RunSummary> {
  const runs = runsOf(runtimeRecords())
    .filter((run) => query.sessionId === null || run.sessionId === query.sessionId)
    .filter((run) => query.runId === null || run.runId === query.runId)
    .sort(byNewestRun)
    .map(summarizeRun)
  return paginate(runs, query)
}

export function readOpenClawEvents(query: EventQuery): PageResult<EventSummary> {
  const events = eventsOf(runtimeRecords())
    .filter((event) => query.sessionId === null || event.sessionId === query.sessionId)
    .filter((event) => query.runId === null || event.runId === query.runId)
    .filter((event) => query.openclawEvent === null || event.openclawEvent === query.openclawEvent)
    .sort(byNewestEvent)
    .map(summarizeEvent)
  return paginate(events, query)
}

export function readOpenClawLedger(query: LedgerQuery): PageResult<LedgerSummary> {
  const ledger = ledgerOf(runtimeRecords())
    .filter((entry) => query.sessionId === null || entry.sessionId === query.sessionId)
    .filter((entry) => query.runId === null || entry.runId === query.runId)
    .filter((entry) => query.openclawEvent === null || entry.openclawEvent === query.openclawEvent)
    .filter((entry) => query.status === null || entry.status === query.status)
    .sort(byNewestLedger)
    .map(summarizeLedger)
  return paginate(ledger, query)
}

export function readOpenClawConnectors(query: ConnectorQuery): PageResult<ConnectorSummary> {
  const connectors = readConnectorsFromRecords(runtimeRecords())
    .filter((connector) => query.platform === null || connector.platform === query.platform)
    .filter((connector) => query.gateway === null || connector.gateway === query.gateway)
    .filter((connector) => query.sessionId === null || connectorHasSession(connector, query.sessionId))
    .map(({ sessionIds: _sessionIds, ...connector }) => connector)
    .sort(byNewestConnector)
  return paginate(connectors, query)
}

function summarizeRun({ rawEvent: _rawEvent, ...run }: RuntimeRunRecord): RunSummary {
  return run
}

function summarizeEvent({ rawEvent: _rawEvent, ...event }: RuntimeEventRecord): EventSummary {
  return event
}

function summarizeLedger({ rawEvent: _rawEvent, ...entry }: RuntimeLedgerEntryRecord): LedgerSummary {
  return entry
}

interface ConnectorAccumulator extends ConnectorSummary {
  readonly sessionIds: ReadonlySet<string>
}

function connectorKey(platform: string, gateway: string): string {
  return `${platform}:${gateway}`
}

function connectorStatus(failureCount: number): ConnectorSummary["status"] {
  return failureCount > 0 ? "degraded" : "healthy"
}

function readConnectorsFromRecords(records: readonly RuntimeEventStoreRecord[]): readonly ConnectorAccumulator[] {
  const connectors = new Map<string, ConnectorAccumulator>()
  for (const record of records) {
    if (record.kind !== "event" && record.kind !== "ledger") continue
    if (record.platform === undefined || record.gateway === undefined) continue
    const key = connectorKey(record.platform, record.gateway)
    const existing = connectors.get(key)
    const isFailure =
      (record.kind === "event" && record.success === false) || (record.kind === "ledger" && record.status === "failure")
    const latestSeenAt =
      existing === undefined || Date.parse(record.createdAt) > Date.parse(existing.latestSeenAt)
        ? record.createdAt
        : existing.latestSeenAt
    const sessionIds = new Set(existing?.sessionIds ?? [])
    sessionIds.add(record.sessionId)
    const failureCount = (existing?.failureCount ?? 0) + (isFailure ? 1 : 0)
    const successCount = (existing?.successCount ?? 0) + (isFailure ? 0 : 1)
    connectors.set(key, {
      connectorId: key,
      platform: record.platform,
      gateway: record.gateway,
      status: connectorStatus(failureCount),
      eventCount: (existing?.eventCount ?? 0) + (record.kind === "event" ? 1 : 0),
      ledgerCount: (existing?.ledgerCount ?? 0) + (record.kind === "ledger" ? 1 : 0),
      successCount,
      failureCount,
      latestSeenAt,
      source: "runtime-records",
      sessionIds,
    })
  }
  return Array.from(connectors.values())
}

function connectorHasSession(connector: ConnectorAccumulator, sessionId: string): boolean {
  return connector.sessionIds.has(sessionId)
}
