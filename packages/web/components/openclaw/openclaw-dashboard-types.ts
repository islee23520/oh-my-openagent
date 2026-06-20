import type { OpenClawRenderableCard } from "@oh-my-opencode/openclaw-core"

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

export interface SessionSummary {
  readonly kind: "session"
  readonly sessionId: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly runCount: number
  readonly eventCount: number
  readonly ledgerCount: number
  readonly latestEventAt: string | null
  readonly projectPath?: string
  readonly tmuxPaneId?: string
  readonly tmuxSession?: string
}

export interface RunSummary {
  readonly kind: "run"
  readonly runId: string
  readonly sessionId: string
  readonly startedAt: string
  readonly projectPath?: string
  readonly tmuxPaneId?: string
  readonly tmuxSession?: string
}

export interface EventSummary {
  readonly kind: "event"
  readonly runId: string
  readonly sessionId: string
  readonly openclawEvent: string
  readonly sequence: number
  readonly correlationId: string
  readonly createdAt: string
  readonly gateway?: string
  readonly success?: boolean
  readonly messageId?: string
  readonly platform?: string
}

export interface LedgerSummary {
  readonly kind: "ledger"
  readonly ledgerId: string
  readonly runId: string
  readonly sessionId: string
  readonly openclawEvent: string
  readonly status: "success" | "failure"
  readonly createdAt: string
  readonly gateway?: string
  readonly messageId?: string
  readonly platform?: string
  readonly error?: string
  readonly statusCode?: number
}

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

export interface DashboardData {
  readonly health: OpenClawHealth
  readonly sessions: PageResult<SessionSummary>
  readonly runs: PageResult<RunSummary>
  readonly events: PageResult<EventSummary>
  readonly ledger: PageResult<LedgerSummary>
  readonly connectors: PageResult<ConnectorSummary>
  readonly cards: readonly OpenClawRenderableCard[]
  readonly invalidEnvelopeMessage: string | null
}

export interface DashboardCopy {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly sessionFilterLabel: string
  readonly refresh: string
  readonly loading: string
  readonly errorTitle: string
  readonly errorBody: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly health: string
  readonly sessions: string
  readonly runs: string
  readonly events: string
  readonly ledger: string
  readonly connectors: string
  readonly cards: string
  readonly invalidEnvelope: string
  readonly latestEvent: string
  readonly runCount: string
  readonly eventCount: string
  readonly ledgerCount: string
  readonly status: string
  readonly platform: string
  readonly gateway: string
}
