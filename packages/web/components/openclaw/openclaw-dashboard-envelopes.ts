import {
  OPENCLAW_ENVELOPE_SCHEMA_VERSION,
  parseOpenClawEnvelope,
  type OpenClawRenderableCard,
  type OpenClawRuntimeStatus,
} from "@oh-my-opencode/openclaw-core"
import type { LedgerSummary, RunSummary } from "./openclaw-dashboard-types"

function runStatusFromLedger(
  run: RunSummary,
  ledger: readonly LedgerSummary[],
): OpenClawRuntimeStatus {
  const matching = ledger.find((entry) => entry.runId === run.runId)
  if (matching?.status === "failure") return "failed"
  if (matching?.status === "success") return "completed"
  return "running"
}

function envelopeForRun(
  run: RunSummary,
  ledger: readonly LedgerSummary[],
  forceInvalidEnvelope: boolean,
): unknown {
  return {
    schemaVersion: OPENCLAW_ENVELOPE_SCHEMA_VERSION,
    componentId: "RUN_STATUS_CARD",
    envelopeId: `run-card-${run.runId}`,
    version: 1,
    createdAt: run.startedAt,
    props: {
      sessionId: run.sessionId,
      runId: run.runId,
      status: forceInvalidEnvelope ? "paused" : runStatusFromLedger(run, ledger),
      title: `Run ${run.runId.slice(0, 8)}`,
      summary: `Session ${run.sessionId} emitted runtime records through the OpenClaw read API.`,
      updatedAt: run.startedAt,
      actions: [
        {
          id: `open-${run.runId}`,
          type: "open_run",
          label: "Open run",
          targetVersion: 1,
        },
      ],
    },
  }
}

export function cardsFromRuns(
  runs: readonly RunSummary[],
  ledger: readonly LedgerSummary[],
  forceInvalidEnvelope: boolean,
): {
  readonly cards: readonly OpenClawRenderableCard[]
  readonly invalidEnvelopeMessage: string | null
} {
  const cards: OpenClawRenderableCard[] = []
  for (const run of runs.slice(0, 4)) {
    const parsed = parseOpenClawEnvelope(envelopeForRun(run, ledger, forceInvalidEnvelope))
    if (!parsed.ok) {
      return {
        cards,
        invalidEnvelopeMessage: `${parsed.error.code}: ${parsed.error.message}`,
      }
    }
    cards.push(parsed.card)
  }
  return { cards, invalidEnvelopeMessage: null }
}
