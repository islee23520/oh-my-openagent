export interface PageInput {
  readonly cursor: string | null
  readonly limit: string | null
}

export interface PageResult<T> {
  readonly data: readonly T[]
  readonly page: {
    readonly limit: number
    readonly nextCursor: string | null
    readonly total: number
  }
}

export interface OpenClawHealth {
  readonly ok: true
  readonly store: {
    readonly recordCount: number
    readonly sessions: number
    readonly runs: number
    readonly events: number
    readonly ledger: number
    readonly connectors: number
  }
}

export type RuntimeRecordKind = "session" | "run" | "event" | "ledger"

interface RuntimeContext {
  readonly sessionId?: string
  readonly projectPath?: string
  readonly tmuxPaneId?: string
  readonly tmuxSession?: string
}

export interface RuntimeSessionRecord extends RuntimeContext {
  readonly kind: "session"
  readonly sessionId: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RuntimeRunRecord extends RuntimeContext {
  readonly kind: "run"
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
  readonly startedAt: string
}

export interface RuntimeEventRecord extends RuntimeContext {
  readonly kind: "event"
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
  readonly openclawEvent: string
  readonly sequence: number
  readonly correlationId: string
  readonly createdAt: string
  readonly gateway?: string
  readonly success?: boolean
  readonly messageId?: string
  readonly platform?: string
}

export interface RuntimeLedgerEntryRecord extends RuntimeContext {
  readonly kind: "ledger"
  readonly ledgerId: string
  readonly runId: string
  readonly sessionId: string
  readonly rawEvent: string
  readonly openclawEvent: string
  readonly status: "success" | "failure"
  readonly createdAt: string
  readonly gateway?: string
  readonly messageId?: string
  readonly platform?: string
  readonly error?: string
  readonly statusCode?: number
}

export type RuntimeEventStoreRecord =
  | RuntimeSessionRecord
  | RuntimeRunRecord
  | RuntimeEventRecord
  | RuntimeLedgerEntryRecord

export interface SessionQuery extends PageInput {
  readonly sessionId: string | null
}

export interface RunQuery extends PageInput {
  readonly sessionId: string | null
  readonly runId: string | null
}

export interface EventQuery extends PageInput {
  readonly sessionId: string | null
  readonly runId: string | null
  readonly openclawEvent: string | null
}

export interface LedgerQuery extends PageInput {
  readonly sessionId: string | null
  readonly runId: string | null
  readonly openclawEvent: string | null
  readonly status: string | null
}

export interface ConnectorQuery extends PageInput {
  readonly sessionId: string | null
  readonly platform: string | null
  readonly gateway: string | null
}

export interface SessionSummary extends RuntimeSessionRecord {
  readonly runCount: number
  readonly eventCount: number
  readonly ledgerCount: number
  readonly latestEventAt: string | null
}

export type RunSummary = Omit<RuntimeRunRecord, "rawEvent">
export type EventSummary = Omit<RuntimeEventRecord, "rawEvent">
export type LedgerSummary = Omit<RuntimeLedgerEntryRecord, "rawEvent">

export interface ConnectorSummary {
  readonly connectorId: string
  readonly platform: string
  readonly gateway: string
  readonly status: "healthy" | "degraded"
  readonly eventCount: number
  readonly ledgerCount: number
  readonly successCount: number
  readonly failureCount: number
  readonly latestSeenAt: string
  readonly source: "runtime-records"
}
