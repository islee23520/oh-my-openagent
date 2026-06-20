import type {
  OpenClawCardSeverity,
  OpenClawEnvelope,
  OpenClawPolicyDecision,
  OpenClawRenderableCard,
  OpenClawRuntimeStatus,
} from "./openclaw-envelope-types"

export function toRenderableCard(envelope: OpenClawEnvelope): OpenClawRenderableCard {
  switch (envelope.componentId) {
    case "RUN_STATUS_CARD":
      return {
        schemaVersion: envelope.schemaVersion,
        componentId: envelope.componentId,
        envelopeId: envelope.envelopeId,
        version: envelope.version,
        title: envelope.props.title,
        subtitle: `${envelope.props.status} - ${envelope.props.runId}`,
        severity: runtimeSeverity(envelope.props.status),
        actions: envelope.props.actions ?? [],
      }
    case "POLICY_CARD":
      return {
        schemaVersion: envelope.schemaVersion,
        componentId: envelope.componentId,
        envelopeId: envelope.envelopeId,
        version: envelope.version,
        title: envelope.props.title,
        subtitle: `${envelope.props.decision} - ${envelope.props.scope}`,
        severity: policySeverity(envelope.props.decision),
        actions: envelope.props.actions ?? [],
      }
    case "TOOL_ACTION_CARD":
      return {
        schemaVersion: envelope.schemaVersion,
        componentId: envelope.componentId,
        envelopeId: envelope.envelopeId,
        version: envelope.version,
        title: envelope.props.title,
        subtitle: `${envelope.props.toolName} - ${envelope.props.action}`,
        severity: "info",
        actions: envelope.props.actions ?? [],
      }
    case "VALIDATION_ERROR_CARD":
      return {
        schemaVersion: envelope.schemaVersion,
        componentId: envelope.componentId,
        envelopeId: envelope.envelopeId,
        version: envelope.version,
        title: envelope.props.code,
        subtitle: envelope.props.message,
        severity: envelope.props.status === 403 ? "danger" : "warning",
        actions: [],
      }
  }
}

function runtimeSeverity(status: OpenClawRuntimeStatus): OpenClawCardSeverity {
  switch (status) {
    case "completed":
      return "success"
    case "failed":
      return "danger"
    case "blocked":
      return "warning"
    case "queued":
    case "running":
      return "info"
  }
}

function policySeverity(decision: OpenClawPolicyDecision): OpenClawCardSeverity {
  switch (decision) {
    case "allow":
      return "success"
    case "deny":
      return "danger"
    case "review":
      return "warning"
  }
}
