import {
  OPENCLAW_ENVELOPE_COMPONENTS,
  OPENCLAW_ENVELOPE_MAX_BYTES,
  OPENCLAW_ENVELOPE_MAX_TEXT_LENGTH,
  OPENCLAW_ENVELOPE_SCHEMA_VERSION,
  type OpenClawActionType,
  type OpenClawCardAction,
  type OpenClawEnvelope,
  type OpenClawEnvelopeComponentId,
  type OpenClawEnvelopeValidationFailure,
  type OpenClawEnvelopeValidationOptions,
  type OpenClawEnvelopeValidationResult,
  type OpenClawPolicyDecision,
  type OpenClawRuntimeStatus,
  type OpenClawValidationStatus,
} from "./openclaw-envelope-types"
import { toRenderableCard } from "./openclaw-envelope-render"

const componentIds = Object.values(OPENCLAW_ENVELOPE_COMPONENTS)
const runtimeStatuses = ["queued", "running", "blocked", "completed", "failed"] as const
const policyDecisions = ["allow", "deny", "review"] as const
const actionTypes = ["approve", "deny", "retry", "cancel", "inspect", "open_run", "view_policy"] as const
const injectionPatterns = ["ignore previous instructions", "developer message", "system prompt", "<script", "javascript:"] as const

type ObjectValue = Readonly<Record<string, unknown>>
interface ParsedBase {
  readonly schemaVersion: typeof OPENCLAW_ENVELOPE_SCHEMA_VERSION
  readonly componentId: OpenClawEnvelopeComponentId
  readonly envelopeId: string
  readonly version: number
  readonly createdAt: string
  readonly props: ObjectValue
}

function failure(
  status: OpenClawValidationStatus,
  code: string,
  message: string,
  path: readonly string[],
): OpenClawEnvelopeValidationFailure {
  return { status, code, message, path, renderableCard: null }
}

function isRecord(value: unknown): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFailure(value: unknown): value is OpenClawEnvelopeValidationFailure {
  return isRecord(value) && (value["status"] === 422 || value["status"] === 403)
}

function text(value: unknown, path: readonly string[]): OpenClawEnvelopeValidationFailure | string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return failure(422, "invalid_text", "Expected a non-empty string.", path)
  }
  if (value.length > OPENCLAW_ENVELOPE_MAX_TEXT_LENGTH) {
    return failure(422, "text_too_large", "Text field exceeds the OpenClaw envelope limit.", path)
  }
  const lowered = value.toLowerCase()
  if (injectionPatterns.some((pattern) => lowered.includes(pattern))) {
    return failure(422, "prompt_injection_text", "Instruction-like text is not renderable card metadata.", path)
  }
  return value
}

function positiveInteger(value: unknown, path: readonly string[]): OpenClawEnvelopeValidationFailure | number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0) return value
  return failure(422, "invalid_version", "Expected a positive integer version.", path)
}

function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  code: string,
  path: readonly string[],
): OpenClawEnvelopeValidationFailure | T {
  if (typeof value === "string") {
    const match = choices.find((choiceValue) => choiceValue === value)
    if (match !== undefined) return match
  }
  return failure(422, code, `Unsupported value at ${path.join(".")}.`, path)
}

function timestamp(value: unknown, path: readonly string[]): OpenClawEnvelopeValidationFailure | string {
  const parsed = text(value, path)
  if (typeof parsed !== "string") return parsed
  const parsedMs = Date.parse(parsed)
  if (Number.isFinite(parsedMs) && new Date(parsedMs).toISOString() === parsed) return parsed
  return failure(422, "invalid_timestamp", "Expected an ISO timestamp.", path)
}

function action(value: unknown, path: readonly string[]): OpenClawEnvelopeValidationFailure | OpenClawCardAction {
  if (!isRecord(value)) return failure(422, "invalid_action", "Card action must be an object.", path)
  const id = text(value["id"], [...path, "id"])
  if (isFailure(id)) return id
  const label = text(value["label"], [...path, "label"])
  if (isFailure(label)) return label
  const typeValue = choice<OpenClawActionType>(value["type"], actionTypes, "unknown_action", [...path, "type"])
  if (isFailure(typeValue)) return typeValue
  const targetVersion = positiveInteger(value["targetVersion"], [...path, "targetVersion"])
  if (isFailure(targetVersion)) return targetVersion
  const expectedRaw = value["expectedVersion"]
  if (expectedRaw === undefined) return { id, type: typeValue, label, targetVersion }
  const expectedVersion = positiveInteger(expectedRaw, [...path, "expectedVersion"])
  if (isFailure(expectedVersion)) return expectedVersion
  return { id, type: typeValue, label, targetVersion, expectedVersion }
}

function actions(value: unknown, path: readonly string[]): OpenClawEnvelopeValidationFailure | readonly OpenClawCardAction[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return failure(422, "invalid_actions", "Card actions must be an array.", path)
  const parsed: OpenClawCardAction[] = []
  for (const [index, rawAction] of value.entries()) {
    const parsedAction = action(rawAction, [...path, String(index)])
    if (isFailure(parsedAction)) return parsedAction
    parsed.push(parsedAction)
  }
  return parsed
}

function staleActionError(
  parsedActions: readonly OpenClawCardAction[],
  options: OpenClawEnvelopeValidationOptions,
): OpenClawEnvelopeValidationFailure | null {
  for (const parsedAction of parsedActions) {
    const current = options.currentActionVersionById?.[parsedAction.id]
    const expected = parsedAction.expectedVersion ?? parsedAction.targetVersion
    if (current !== undefined && expected < current) {
      return failure(403, "stale_action", "Action target version is stale.", ["props", "actions", parsedAction.id])
    }
  }
  return null
}

function common(value: ObjectValue): OpenClawEnvelopeValidationFailure | ParsedBase {
  if (value["schemaVersion"] !== OPENCLAW_ENVELOPE_SCHEMA_VERSION) {
    return failure(422, "unsupported_schema_version", "Unsupported OpenClaw envelope schema version.", ["schemaVersion"])
  }
  const componentId = choice<OpenClawEnvelopeComponentId>(
    value["componentId"],
    componentIds,
    "unknown_component",
    ["componentId"],
  )
  if (isFailure(componentId)) return componentId
  const envelopeId = text(value["envelopeId"], ["envelopeId"])
  if (isFailure(envelopeId)) return envelopeId
  if (value["version"] === undefined) return failure(422, "missing_version", "Envelope version is required.", ["version"])
  const version = positiveInteger(value["version"], ["version"])
  if (isFailure(version)) return version
  const createdAt = timestamp(value["createdAt"], ["createdAt"])
  if (isFailure(createdAt)) return createdAt
  if (!isRecord(value["props"])) return failure(422, "invalid_props", "Envelope props must be an object.", ["props"])
  return { schemaVersion: OPENCLAW_ENVELOPE_SCHEMA_VERSION, componentId, envelopeId, version, createdAt, props: value["props"] }
}

function parseEnvelope(value: ObjectValue, options: OpenClawEnvelopeValidationOptions): OpenClawEnvelopeValidationFailure | OpenClawEnvelope {
  const base = common(value)
  if (isFailure(base)) return base
  const parsedActions = actions(base.props["actions"], ["props", "actions"])
  if (isFailure(parsedActions)) return parsedActions
  const stale = staleActionError(parsedActions, options)
  if (stale !== null) return stale
  switch (base.componentId) {
    case "RUN_STATUS_CARD": {
      const status = choice<OpenClawRuntimeStatus>(base.props["status"], runtimeStatuses, "invalid_runtime_status", ["props", "status"])
      if (isFailure(status)) return status
      const sessionId = text(base.props["sessionId"], ["props", "sessionId"])
      const runId = text(base.props["runId"], ["props", "runId"])
      const title = text(base.props["title"], ["props", "title"])
      const summary = text(base.props["summary"], ["props", "summary"])
      const updatedAt = timestamp(base.props["updatedAt"], ["props", "updatedAt"])
      if (isFailure(sessionId)) return sessionId
      if (isFailure(runId)) return runId
      if (isFailure(title)) return title
      if (isFailure(summary)) return summary
      if (isFailure(updatedAt)) return updatedAt
      return { ...base, componentId: "RUN_STATUS_CARD", props: { sessionId, runId, status, title, summary, updatedAt, actions: parsedActions } }
    }
    case "POLICY_CARD":
    case "TOOL_ACTION_CARD":
    case "VALIDATION_ERROR_CARD":
      return parseNonRuntimeEnvelope(base, parsedActions)
  }
}

function parseNonRuntimeEnvelope(
  base: ParsedBase,
  parsedActions: readonly OpenClawCardAction[],
): OpenClawEnvelopeValidationFailure | OpenClawEnvelope {
  if (base.componentId === "POLICY_CARD") return parsePolicyEnvelope(base, parsedActions)
  if (base.componentId === "TOOL_ACTION_CARD") return parseToolEnvelope(base, parsedActions)
  return parseValidationEnvelope(base)
}

function parsePolicyEnvelope(base: ParsedBase, parsedActions: readonly OpenClawCardAction[]): OpenClawEnvelopeValidationFailure | OpenClawEnvelope {
  const actor = text(base.props["actor"], ["props", "actor"])
  const actionValue = choice<OpenClawActionType>(base.props["action"], actionTypes, "unknown_action", ["props", "action"])
  const scope = text(base.props["scope"], ["props", "scope"])
  const decision = choice<OpenClawPolicyDecision>(base.props["decision"], policyDecisions, "invalid_policy_decision", ["props", "decision"])
  const reason = text(base.props["reason"], ["props", "reason"])
  const title = text(base.props["title"], ["props", "title"])
  const policyVersion = positiveInteger(base.props["policyVersion"], ["props", "policyVersion"])
  if (isFailure(actor)) return actor
  if (isFailure(actionValue)) return actionValue
  if (isFailure(scope)) return scope
  if (isFailure(decision)) return decision
  if (isFailure(reason)) return reason
  if (isFailure(title)) return title
  if (isFailure(policyVersion)) return policyVersion
  return { ...base, componentId: "POLICY_CARD", props: { actor, action: actionValue, scope, decision, reason, policyVersion, title, actions: parsedActions } }
}

function parseToolEnvelope(base: ParsedBase, parsedActions: readonly OpenClawCardAction[]): OpenClawEnvelopeValidationFailure | OpenClawEnvelope {
  const toolName = text(base.props["toolName"], ["props", "toolName"])
  const actionValue = choice<OpenClawActionType>(base.props["action"], actionTypes, "unknown_action", ["props", "action"])
  const actionId = text(base.props["actionId"], ["props", "actionId"])
  const actionVersion = positiveInteger(base.props["actionVersion"], ["props", "actionVersion"])
  const title = text(base.props["title"], ["props", "title"])
  const description = text(base.props["description"], ["props", "description"])
  if (isFailure(toolName)) return toolName
  if (isFailure(actionValue)) return actionValue
  if (isFailure(actionId)) return actionId
  if (isFailure(actionVersion)) return actionVersion
  if (isFailure(title)) return title
  if (isFailure(description)) return description
  return { ...base, componentId: "TOOL_ACTION_CARD", props: { toolName, action: actionValue, actionId, actionVersion, title, description, actions: parsedActions } }
}

function parseValidationEnvelope(base: ParsedBase): OpenClawEnvelopeValidationFailure | OpenClawEnvelope {
  const status = base.props["status"]
  if (status !== 422 && status !== 403) {
    return failure(422, "invalid_validation_status", "Validation errors must use 422 or 403 status.", ["props", "status"])
  }
  const code = text(base.props["code"], ["props", "code"])
  const message = text(base.props["message"], ["props", "message"])
  if (isFailure(code)) return code
  if (isFailure(message)) return message
  const pathRaw = base.props["path"]
  if (pathRaw === undefined) return { ...base, componentId: "VALIDATION_ERROR_CARD", props: { status, code, message } }
  if (!Array.isArray(pathRaw)) return failure(422, "invalid_path", "Validation error path must be an array.", ["props", "path"])
  const parsedPath: string[] = []
  for (const [index, pathPart] of pathRaw.entries()) {
    const parsedPart = text(pathPart, ["props", "path", String(index)])
    if (isFailure(parsedPart)) return parsedPart
    parsedPath.push(parsedPart)
  }
  return { ...base, componentId: "VALIDATION_ERROR_CARD", props: { status, code, message, path: parsedPath } }
}

export function parseOpenClawEnvelope(
  value: unknown,
  options: OpenClawEnvelopeValidationOptions = {},
): OpenClawEnvelopeValidationResult {
  const maxBytes = options.maxBytes ?? OPENCLAW_ENVELOPE_MAX_BYTES
  const encoded = JSON.stringify(value)
  if (encoded.length > maxBytes) {
    return { ok: false, error: failure(422, "envelope_too_large", "Envelope exceeds the OpenClaw envelope byte limit.", []) }
  }
  if (!isRecord(value)) {
    return { ok: false, error: failure(422, "invalid_envelope", "Envelope must be an object.", []) }
  }
  const envelope = parseEnvelope(value, options)
  if (isFailure(envelope)) return { ok: false, error: envelope }
  return { ok: true, envelope, card: toRenderableCard(envelope) }
}
