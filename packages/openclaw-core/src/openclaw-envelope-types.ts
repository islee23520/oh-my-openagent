export const OPENCLAW_ENVELOPE_SCHEMA_VERSION = "openclaw.envelope.v1"
export const OPENCLAW_ENVELOPE_MAX_BYTES = 16_384
export const OPENCLAW_ENVELOPE_MAX_TEXT_LENGTH = 2_048

export const OPENCLAW_ENVELOPE_COMPONENTS = {
  runStatus: "RUN_STATUS_CARD",
  policy: "POLICY_CARD",
  toolAction: "TOOL_ACTION_CARD",
  validationError: "VALIDATION_ERROR_CARD",
} as const

export type OpenClawEnvelopeComponentId =
  (typeof OPENCLAW_ENVELOPE_COMPONENTS)[keyof typeof OPENCLAW_ENVELOPE_COMPONENTS]

export type OpenClawCardSeverity = "info" | "success" | "warning" | "danger"

export type OpenClawActionType =
  | "approve"
  | "deny"
  | "retry"
  | "cancel"
  | "inspect"
  | "open_run"
  | "view_policy"

export type OpenClawRuntimeStatus =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed"

export type OpenClawPolicyDecision = "allow" | "deny" | "review"
export type OpenClawValidationStatus = 422 | 403

export interface OpenClawCardAction {
  readonly id: string
  readonly type: OpenClawActionType
  readonly label: string
  readonly targetVersion: number
  readonly expectedVersion?: number
}

export interface OpenClawEnvelopeBase<TComponent extends OpenClawEnvelopeComponentId, TProps> {
  readonly schemaVersion: typeof OPENCLAW_ENVELOPE_SCHEMA_VERSION
  readonly componentId: TComponent
  readonly envelopeId: string
  readonly version: number
  readonly createdAt: string
  readonly props: TProps
}

export interface OpenClawRunStatusCardProps {
  readonly sessionId: string
  readonly runId: string
  readonly status: OpenClawRuntimeStatus
  readonly title: string
  readonly summary: string
  readonly updatedAt: string
  readonly actions?: readonly OpenClawCardAction[]
}

export interface OpenClawPolicyCardProps {
  readonly actor: string
  readonly action: OpenClawActionType
  readonly scope: string
  readonly decision: OpenClawPolicyDecision
  readonly reason: string
  readonly policyVersion: number
  readonly title: string
  readonly actions?: readonly OpenClawCardAction[]
}

export interface OpenClawToolActionCardProps {
  readonly toolName: string
  readonly action: OpenClawActionType
  readonly actionId: string
  readonly actionVersion: number
  readonly title: string
  readonly description: string
  readonly actions?: readonly OpenClawCardAction[]
}

export interface OpenClawValidationErrorCardProps {
  readonly status: OpenClawValidationStatus
  readonly code: string
  readonly message: string
  readonly path?: readonly string[]
}

export type OpenClawRunStatusEnvelope = OpenClawEnvelopeBase<
  typeof OPENCLAW_ENVELOPE_COMPONENTS.runStatus,
  OpenClawRunStatusCardProps
>

export type OpenClawPolicyEnvelope = OpenClawEnvelopeBase<
  typeof OPENCLAW_ENVELOPE_COMPONENTS.policy,
  OpenClawPolicyCardProps
>

export type OpenClawToolActionEnvelope = OpenClawEnvelopeBase<
  typeof OPENCLAW_ENVELOPE_COMPONENTS.toolAction,
  OpenClawToolActionCardProps
>

export type OpenClawValidationErrorEnvelope = OpenClawEnvelopeBase<
  typeof OPENCLAW_ENVELOPE_COMPONENTS.validationError,
  OpenClawValidationErrorCardProps
>

export type OpenClawEnvelope =
  | OpenClawRunStatusEnvelope
  | OpenClawPolicyEnvelope
  | OpenClawToolActionEnvelope
  | OpenClawValidationErrorEnvelope

export interface OpenClawRenderableCard {
  readonly schemaVersion: typeof OPENCLAW_ENVELOPE_SCHEMA_VERSION
  readonly componentId: OpenClawEnvelopeComponentId
  readonly envelopeId: string
  readonly version: number
  readonly title: string
  readonly subtitle?: string
  readonly severity: OpenClawCardSeverity
  readonly actions: readonly OpenClawCardAction[]
}

export interface OpenClawEnvelopeValidationFailure {
  readonly status: OpenClawValidationStatus
  readonly code: string
  readonly message: string
  readonly path: readonly string[]
  readonly renderableCard: null
}

export interface OpenClawEnvelopeValidationSuccess {
  readonly ok: true
  readonly envelope: OpenClawEnvelope
  readonly card: OpenClawRenderableCard
}

export interface OpenClawEnvelopeValidationErrorResult {
  readonly ok: false
  readonly error: OpenClawEnvelopeValidationFailure
}

export type OpenClawEnvelopeValidationResult =
  | OpenClawEnvelopeValidationSuccess
  | OpenClawEnvelopeValidationErrorResult

export interface OpenClawEnvelopeValidationOptions {
  readonly maxBytes?: number
  readonly currentActionVersionById?: Readonly<Record<string, number>>
}
