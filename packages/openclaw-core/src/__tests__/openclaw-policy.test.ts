import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { getRuntimeEventStorePath } from "../event-store-paths"
import { evaluateAndAuditOpenClawPolicy, evaluateOpenClawPolicy } from "../openclaw-policy"
import { loadOpenClawPolicyLedgerRecords } from "../policy-ledger"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempDataHome = mkdtempSync(join(tmpdir(), "openclaw-policy-"))

const baseRequest = {
  action: "approve-run",
  scope: "control-plane",
  sessionId: "session-12",
  runId: "run-12",
  correlationId: "corr-12",
  targetVersion: 7,
  currentVersion: 7,
  before: { status: "waiting-approval" },
  after: { status: "approved" },
} as const

beforeEach(() => {
  process.env.XDG_DATA_HOME = tempDataHome
  const runtimeStoreDir = dirname(getRuntimeEventStorePath())
  rmSync(runtimeStoreDir, { recursive: true, force: true })
  mkdirSync(runtimeStoreDir, { recursive: true })
})

afterAll(() => {
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalXdgDataHome
  rmSync(tempDataHome, { recursive: true, force: true })
})

describe("OpenClaw policy", () => {
  test("allows qa admin to approve a current run", () => {
    // Given: the deterministic test admin token matches the admin actor.
    const request = {
      ...baseRequest,
      actor: "qa-admin",
      bearerToken: "qa-token",
    }

    // When: the control-plane mutating action is evaluated.
    const result = evaluateOpenClawPolicy(request)

    // Then: the decision allows the mutation and preserves audit context.
    expect(result).toMatchObject({
      statusCode: 200,
      decision: "allow",
      actor: "qa-admin",
      action: "approve-run",
      scope: "control-plane",
      sessionId: "session-12",
      runId: "run-12",
      correlationId: "corr-12",
      before: { status: "waiting-approval" },
      after: { status: "approved" },
    })
  })

  test("denies missing auth with a 401 audit record", () => {
    // Given: no bearer token accompanies the mutating action.
    const request = {
      ...baseRequest,
      actor: "qa-admin",
    }

    // When: the policy evaluates the request.
    const result = evaluateOpenClawPolicy(request)

    // Then: the decision is a 401 deny with the denial reason in the audit shape.
    expect(result).toMatchObject({
      statusCode: 401,
      decision: "deny",
      actor: "qa-admin",
      action: "approve-run",
      scope: "control-plane",
      sessionId: "session-12",
      runId: "run-12",
      correlationId: "corr-12",
      denialReason: "missing_auth",
    })
  })

  test("denies reader token for approve run with 403", () => {
    // Given: the deterministic reader token belongs to a reader actor.
    const request = {
      ...baseRequest,
      actor: "qa-reader",
      bearerToken: "qa-reader-token",
    }

    // When: the reader tries to approve a run.
    const result = evaluateOpenClawPolicy(request)

    // Then: the policy denies the mutation without dropping audit context.
    expect(result).toMatchObject({
      statusCode: 403,
      decision: "deny",
      actor: "qa-reader",
      action: "approve-run",
      scope: "control-plane",
      sessionId: "session-12",
      runId: "run-12",
      correlationId: "corr-12",
      denialReason: "forbidden",
    })
  })

  test("rejects stale target version with 409", () => {
    // Given: the action was created against an older control-plane version.
    const request = {
      ...baseRequest,
      actor: "qa-admin",
      bearerToken: "qa-token",
      targetVersion: 6,
      currentVersion: 7,
    }

    // When: the admin submits the stale action.
    const result = evaluateOpenClawPolicy(request)

    // Then: the policy rejects the mutation as stale with version fields.
    expect(result).toMatchObject({
      statusCode: 409,
      decision: "deny",
      actor: "qa-admin",
      action: "approve-run",
      scope: "control-plane",
      sessionId: "session-12",
      runId: "run-12",
      correlationId: "corr-12",
      denialReason: "stale_version",
      targetVersion: 6,
      currentVersion: 7,
    })
  })

  test("appends allow and deny decisions to the runtime audit ledger", () => {
    // Given: an authorized approval and a stale approval share runtime identity.
    const allowedRequest = {
      ...baseRequest,
      actor: "qa-admin",
      bearerToken: "qa-token",
    }
    const staleRequest = {
      ...baseRequest,
      actor: "qa-admin",
      bearerToken: "qa-token",
      targetVersion: 6,
      currentVersion: 7,
      correlationId: "corr-12-stale",
    }

    // When: both policy decisions are evaluated through the audited entry point.
    const allowed = evaluateAndAuditOpenClawPolicy(allowedRequest)
    const stale = evaluateAndAuditOpenClawPolicy(staleRequest)

    // Then: both decisions are persisted as append-only runtime ledger records.
    expect(allowed.ledgerRecord).toMatchObject({
      kind: "ledger",
      auditKind: "openclaw-policy",
      actor: "qa-admin",
      action: "approve-run",
      decision: "allow",
      scope: "control-plane",
      sessionId: "session-12",
      runId: "run-12",
      correlationId: "corr-12",
      status: "success",
      statusCode: 200,
      before: { status: "waiting-approval" },
      after: { status: "approved" },
    })
    expect(stale.ledgerRecord).toMatchObject({
      kind: "ledger",
      auditKind: "openclaw-policy",
      decision: "deny",
      denialReason: "stale_version",
      status: "failure",
      statusCode: 409,
      targetVersion: 6,
      currentVersion: 7,
    })

    const policyLedgers = [
      ...loadOpenClawPolicyLedgerRecords("session-12", "corr-12"),
      ...loadOpenClawPolicyLedgerRecords("session-12", "corr-12-stale"),
    ]
    expect(policyLedgers).toHaveLength(2)
    expect(policyLedgers.map((record) => record.correlationId)).toEqual(["corr-12", "corr-12-stale"])
  })
})
