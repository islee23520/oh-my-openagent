import type { Metadata } from "next"
import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { OpenClawDashboard } from "@/components/openclaw/openclaw-dashboard"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "OpenClaw Control Plane",
  description: "Live OpenClaw runtime sessions, runs, events, connectors, and typed status cards.",
}

export default async function OpenClawPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly sessionId?: string; readonly invalidEnvelope?: string }>
}): Promise<JSX.Element> {
  const params = await searchParams
  const t = await getTranslations("openclaw")

  return (
    <OpenClawDashboard
      copy={{
        eyebrow: t("eyebrow"),
        title: t("title"),
        description: t("description"),
        sessionFilterLabel: t("sessionFilterLabel"),
        refresh: t("refresh"),
        loading: t("loading"),
        errorTitle: t("errorTitle"),
        errorBody: t("errorBody"),
        emptyTitle: t("emptyTitle"),
        emptyBody: t("emptyBody"),
        health: t("sections.health"),
        sessions: t("sections.sessions"),
        runs: t("sections.runs"),
        events: t("sections.events"),
        ledger: t("sections.ledger"),
        connectors: t("sections.connectors"),
        cards: t("sections.cards"),
        memory: t("sections.memory"),
        invalidEnvelope: t("invalidEnvelope"),
        latestEvent: t("fields.latestEvent"),
        runCount: t("fields.runCount"),
        eventCount: t("fields.eventCount"),
        ledgerCount: t("fields.ledgerCount"),
        status: t("fields.status"),
        platform: t("fields.platform"),
        gateway: t("fields.gateway"),
        sourceSession: t("fields.sourceSession"),
        pinned: t("fields.pinned"),
      }}
      initialSessionId={params.sessionId ?? ""}
      forceApiError={process.env.OPENCLAW_FORCE_API_ERROR === "1"}
      forceInvalidEnvelope={params.invalidEnvelope === "1"}
    />
  )
}
