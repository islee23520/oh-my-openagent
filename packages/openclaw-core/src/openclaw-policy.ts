import {
  appendOpenClawPolicyLedgerEntry,
  type OpenClawPolicyLedgerRecord,
} from "./policy-ledger"

export type OpenClawPolicyAction = "approve-run"
export type OpenClawPolicyGateDecision = "allow" | "deny"
export type OpenClawPolicyStatusCode = 200 | 401 | 403 | 409
export type OpenClawPolicyDenialReason =
  | "missing_auth"
  | "invalid_auth"
  | "forbidden"
  | "stale_version"

export type OpenClawPolicySnapshot = Readonly<Record<string, unknown>>

export interface OpenClawPolicyInput {
  readonly actor: string
  readonly bearerToken?: string
  readonly action: OpenClawPolicyAction
  readonly scope: string
  readonly sessionId: string
  readonly runId: string
  readonly correlationId: string
  readonly targetVersion: number
  readonly currentVersion: number
  readonly before?: OpenClawPolicySnapshot
  readonly after?: OpenClawPolicySnapshot
}

export interface OpenClawPolicyDecisionResult {
  readonly statusCode: OpenClawPolicyStatusCode
  readonly decision: OpenClawPolicyGateDecision
  readonly actor: string
  readonly action: OpenClawPolicyAction
  readonly scope: string
  readonly sessionId: string
  readonly runId: string
  readonly correlationId: string
  readonly denialReason?: OpenClawPolicyDenialReason
  readonly targetVersion?: number
  readonly currentVersion?: number
  readonly before?: OpenClawPolicySnapshot
  readonly after?: OpenClawPolicySnapshot
}

export interface OpenClawPolicyAuditResult {
  readonly policyResult: OpenClawPolicyDecisionResult
  readonly ledgerRecord: OpenClawPolicyLedgerRecord | null
}

const OPENCLAW_TEST_POLICY_ACTORS: Record<
  string,
  {
    readonly bearerToken: string
    readonly allowedActions: readonly OpenClawPolicyAction[]
  }
> = {
  "qa-admin": {
    bearerToken: "qa-token",
    allowedActions: ["approve-run"],
  },
  "qa-reader": {
    bearerToken: "qa-reader-token",
    allowedActions: [],
  },
}

function auditBase(input: OpenClawPolicyInput): Omit<
  OpenClawPolicyDecisionResult,
  "decision" | "statusCode"
> {
  return {
    actor: input.actor,
    action: input.action,
    scope: input.scope,
    sessionId: input.sessionId,
    runId: input.runId,
    correlationId: input.correlationId,
  }
}

function deny(
  input: OpenClawPolicyInput,
  statusCode: Exclude<OpenClawPolicyStatusCode, 200>,
  denialReason: OpenClawPolicyDenialReason,
): OpenClawPolicyDecisionResult {
  return {
    ...auditBase(input),
    statusCode,
    decision: "deny",
    denialReason,
    ...(denialReason === "stale_version" && {
      targetVersion: input.targetVersion,
      currentVersion: input.currentVersion,
    }),
  }
}

export function evaluateOpenClawPolicy(
  input: OpenClawPolicyInput,
): OpenClawPolicyDecisionResult {
  if (!input.bearerToken) {
    return deny(input, 401, "missing_auth")
  }

  const actorPolicy = OPENCLAW_TEST_POLICY_ACTORS[input.actor]
  if (!actorPolicy || actorPolicy.bearerToken !== input.bearerToken) {
    return deny(input, 401, "invalid_auth")
  }

  if (!actorPolicy.allowedActions.includes(input.action)) {
    return deny(input, 403, "forbidden")
  }

  if (input.targetVersion !== input.currentVersion) {
    return deny(input, 409, "stale_version")
  }

  return {
    ...auditBase(input),
    statusCode: 200,
    decision: "allow",
    ...(input.before !== undefined && { before: input.before }),
    ...(input.after !== undefined && { after: input.after }),
  }
}

export function evaluateAndAuditOpenClawPolicy(
  input: OpenClawPolicyInput,
): OpenClawPolicyAuditResult {
  const policyResult = evaluateOpenClawPolicy(input)
  const ledgerRecord = appendOpenClawPolicyLedgerEntry({
    actor: policyResult.actor,
    action: policyResult.action,
    decision: policyResult.decision,
    scope: policyResult.scope,
    sessionId: policyResult.sessionId,
    runId: policyResult.runId,
    correlationId: policyResult.correlationId,
    statusCode: policyResult.statusCode,
    denialReason: policyResult.denialReason,
    targetVersion: policyResult.targetVersion,
    currentVersion: policyResult.currentVersion,
    before: policyResult.before,
    after: policyResult.after,
  })
  return { policyResult, ledgerRecord }
}
