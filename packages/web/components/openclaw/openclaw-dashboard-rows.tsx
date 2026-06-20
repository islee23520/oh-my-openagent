import type { JSX } from "react"
import { Badge } from "@/components/ui/badge"
import { compactDate, shortId, statusClass } from "./openclaw-dashboard-format"
import type {
  ConnectorSummary,
  DashboardCopy,
  DashboardData,
  EventSummary,
  LedgerSummary,
  RunSummary,
  SessionSummary,
} from "./openclaw-dashboard-types"

export function SessionRow({
  session,
  copy,
}: {
  readonly session: SessionSummary
  readonly copy: DashboardCopy
}): JSX.Element {
  return (
    <article className="p-4" data-testid={`session-${session.sessionId}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-sm text-zinc-100">{session.sessionId}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {copy.latestEvent}: {compactDate(session.latestEventAt ?? session.updatedAt)}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs text-zinc-400">
          <span>
            <strong className="block text-zinc-100">{session.runCount}</strong>
            {copy.runCount}
          </span>
          <span>
            <strong className="block text-zinc-100">{session.eventCount}</strong>
            {copy.eventCount}
          </span>
          <span>
            <strong className="block text-zinc-100">{session.ledgerCount}</strong>
            {copy.ledgerCount}
          </span>
        </div>
      </div>
    </article>
  )
}

export function RunRow({ run }: { readonly run: RunSummary }): JSX.Element {
  return (
    <article className="p-4" data-testid={`run-${run.runId}`}>
      <p className="font-mono text-sm text-zinc-100">{run.runId}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {run.sessionId} / {compactDate(run.startedAt)}
      </p>
    </article>
  )
}

export function EventRow({ event }: { readonly event: EventSummary }): JSX.Element {
  return (
    <article className="p-4" data-testid={`event-${event.correlationId}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-sm text-zinc-100">{event.openclawEvent}</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            {shortId(event.runId)} / seq {event.sequence}
          </p>
        </div>
        <Badge
          variant="outline"
          className={statusClass(event.success === false ? "failure" : "success")}
        >
          {event.success === false ? "failure" : "success"}
        </Badge>
      </div>
    </article>
  )
}

export function LedgerRow({ entry }: { readonly entry: LedgerSummary }): JSX.Element {
  return (
    <article className="p-4" data-testid={`ledger-${entry.ledgerId}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-sm text-zinc-100">{entry.openclawEvent}</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{shortId(entry.ledgerId)}</p>
        </div>
        <Badge variant="outline" className={statusClass(entry.status)}>
          {entry.status}
        </Badge>
      </div>
    </article>
  )
}

export function ConnectorRow({
  connector,
  copy,
}: {
  readonly connector: ConnectorSummary
  readonly copy: DashboardCopy
}): JSX.Element {
  return (
    <article className="p-4" data-testid={`connector-${connector.connectorId}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-sm text-zinc-100">{connector.connectorId}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {copy.platform}: {connector.platform} / {copy.gateway}: {connector.gateway}
          </p>
        </div>
        <Badge variant="outline" className={statusClass(connector.status)}>
          {connector.status}
        </Badge>
      </div>
    </article>
  )
}

export function CardsPanel({
  data,
  copy,
}: {
  readonly data: DashboardData
  readonly copy: DashboardCopy
}): JSX.Element {
  return (
    <>
      {data.invalidEnvelopeMessage !== null ? (
        <div className="p-4" data-testid="openclaw-invalid-envelope">
          <Badge variant="outline" className={statusClass("danger")}>
            {copy.invalidEnvelope}
          </Badge>
          <p className="mt-3 font-mono text-xs leading-6 text-red-200/80">
            {data.invalidEnvelopeMessage}
          </p>
        </div>
      ) : (
        data.cards.map((card) => (
          <article key={card.envelopeId} className="p-4" data-testid={`card-${card.componentId}`}>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-mono text-sm text-zinc-100">{card.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{card.subtitle}</p>
              </div>
              <Badge variant="outline" className={statusClass(card.severity)}>
                {card.componentId}
              </Badge>
            </div>
          </article>
        ))
      )}
    </>
  )
}
