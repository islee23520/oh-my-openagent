import type { JSX, ReactNode } from "react"
import { Activity, Database, ShieldAlert, TerminalSquare, Wifi } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  CardsPanel,
  ConnectorRow,
  EventRow,
  LedgerRow,
  RunRow,
  SessionRow,
} from "./openclaw-dashboard-rows"
import type { DashboardCopy, DashboardData } from "./openclaw-dashboard-types"

function Metric({
  label,
  value,
  icon,
}: {
  readonly label: string
  readonly value: number | string
  readonly icon: JSX.Element
}): JSX.Element {
  return (
    <div className="border border-zinc-800 bg-zinc-950/60 p-4" data-testid={`metric-${label}`}>
      <div className="flex items-center justify-between gap-3 text-xs font-medium tracking-[0.08em] text-zinc-500 uppercase">
        <span>{label}</span>
        <span className="text-cyan-400">{icon}</span>
      </div>
      <div className="mt-3 font-mono text-3xl font-semibold tracking-normal text-zinc-100">
        {value}
      </div>
    </div>
  )
}

function Panel({
  title,
  children,
  className,
}: {
  readonly title: string
  readonly children: ReactNode
  readonly className?: string
}): JSX.Element {
  return (
    <section className={cn("border border-zinc-800 bg-zinc-950/50", className)}>
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="font-mono text-xs font-semibold tracking-[0.1em] text-zinc-400 uppercase">
          {title}
        </h2>
      </div>
      <div className="divide-y divide-zinc-900">{children}</div>
    </section>
  )
}

function EmptyState({ copy }: { readonly copy: DashboardCopy }): JSX.Element {
  return (
    <div
      className="border border-dashed border-zinc-800 bg-zinc-950/40 p-8 text-center"
      data-testid="openclaw-empty"
    >
      <p className="text-lg font-semibold text-zinc-100">{copy.emptyTitle}</p>
      <p className="mx-auto mt-2 max-w-[58ch] text-sm leading-6 text-zinc-400">{copy.emptyBody}</p>
    </div>
  )
}

export function LoadingState({ copy }: { readonly copy: DashboardCopy }): JSX.Element {
  return (
    <div className="space-y-4" data-testid="openclaw-loading">
      <p className="font-mono text-sm text-cyan-300">{copy.loading}</p>
      <div className="grid gap-3 md:grid-cols-3">
        {["sessions", "runs", "events"].map((item) => (
          <div key={item} className="h-28 animate-pulse border border-zinc-800 bg-zinc-900/60" />
        ))}
      </div>
    </div>
  )
}

export function ErrorState({
  copy,
  message,
}: {
  readonly copy: DashboardCopy
  readonly message: string
}): JSX.Element {
  return (
    <div className="border border-red-500/30 bg-red-950/20 p-6" data-testid="openclaw-error">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-red-100">{copy.errorTitle}</p>
          <p className="mt-2 text-sm leading-6 text-red-200/80">{copy.errorBody}</p>
          <p className="mt-3 font-mono text-xs text-red-200/70">{message}</p>
        </div>
      </div>
    </div>
  )
}

export function DashboardBody({
  data,
  copy,
}: {
  readonly data: DashboardData
  readonly copy: DashboardCopy
}): JSX.Element {
  const hasData = data.sessions.data.length > 0
  if (!hasData) return <EmptyState copy={copy} />
  return (
    <div className="space-y-6" data-testid="openclaw-dashboard-ready">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="records"
          value={data.health.store.recordCount}
          icon={<Database className="h-4 w-4" />}
        />
        <Metric
          label="sessions"
          value={data.health.store.sessions}
          icon={<TerminalSquare className="h-4 w-4" />}
        />
        <Metric
          label="runs"
          value={data.health.store.runs}
          icon={<Activity className="h-4 w-4" />}
        />
        <Metric
          label="events"
          value={data.health.store.events}
          icon={<Activity className="h-4 w-4" />}
        />
        <Metric
          label="ledger"
          value={data.health.store.ledger}
          icon={<Database className="h-4 w-4" />}
        />
        <Metric
          label="connectors"
          value={data.health.store.connectors}
          icon={<Wifi className="h-4 w-4" />}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title={copy.sessions}>
          {data.sessions.data.map((session) => (
            <SessionRow key={session.sessionId} session={session} copy={copy} />
          ))}
        </Panel>
        <Panel title={copy.cards}>
          <CardsPanel data={data} copy={copy} />
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={copy.runs}>
          {data.runs.data.slice(0, 6).map((run) => (
            <RunRow key={run.runId} run={run} />
          ))}
        </Panel>
        <Panel title={copy.events}>
          {data.events.data.slice(0, 6).map((event) => (
            <EventRow key={event.correlationId} event={event} />
          ))}
        </Panel>
        <Panel title={copy.ledger}>
          {data.ledger.data.slice(0, 6).map((entry) => (
            <LedgerRow key={entry.ledgerId} entry={entry} />
          ))}
        </Panel>
        <Panel title={copy.connectors}>
          {data.connectors.data.map((connector) => (
            <ConnectorRow key={connector.connectorId} connector={connector} copy={copy} />
          ))}
        </Panel>
      </div>
    </div>
  )
}
