import { randomUUID } from "node:crypto"
import {
  appendRuntimeLedgerEntry,
  loadRuntimeEventStoreRecords,
  type RuntimeLedgerEntryRecord,
} from "./event-store"
import type {
  OpenClawPolicyAction,
  OpenClawPolicyDenialReason,
  OpenClawPolicyGateDecision,
  OpenClawPolicySnapshot,
  OpenClawPolicyStatusCode,
} from "./openclaw-policy"

export interface OpenClawPolicyLedgerRecord extends RuntimeLedgerEntryRecord {
  readonly auditKind: "openclaw-policy"
  readonly actor: string
  readonly action: OpenClawPolicyAction
  readonly decision: OpenClawPolicyGateDecision
  readonly scope: string
  readonly correlationId: string
  readonly statusCode: OpenClawPolicyStatusCode
  readonly denialReason?: OpenClawPolicyDenialReason
  readonly targetVersion?: number
  readonly currentVersion?: number
  readonly before?: OpenClawPolicySnapshot
  readonly after?: OpenClawPolicySnapshot
}

export interface OpenClawPolicyLedgerAppend {
  readonly actor: string
  readonly action: OpenClawPolicyAction
  readonly decision: OpenClawPolicyGateDecision
  readonly scope: string
  readonly sessionId: string
  readonly runId: string
  readonly correlationId: string
  readonly statusCode: OpenClawPolicyStatusCode
  readonly denialReason?: OpenClawPolicyDenialReason
  readonly targetVersion?: number
  readonly currentVersion?: number
  readonly before?: OpenClawPolicySnapshot
  readonly after?: OpenClawPolicySnapshot
}

export function isOpenClawPolicyLedgerRecord(
  record: RuntimeLedgerEntryRecord,
): record is OpenClawPolicyLedgerRecord {
  return "auditKind" in record && record.auditKind === "openclaw-policy"
}

export function appendOpenClawPolicyLedgerEntry(
  entry: OpenClawPolicyLedgerAppend,
): OpenClawPolicyLedgerRecord | null {
  const ledgerRecord: OpenClawPolicyLedgerRecord = {
    kind: "ledger",
    ledgerId: randomUUID(),
    runId: entry.runId,
    sessionId: entry.sessionId,
    rawEvent: "openclaw.policy",
    openclawEvent: entry.action,
    status: entry.decision === "allow" ? "success" : "failure",
    createdAt: new Date().toISOString(),
    statusCode: entry.statusCode,
    auditKind: "openclaw-policy",
    actor: entry.actor,
    action: entry.action,
    decision: entry.decision,
    scope: entry.scope,
    correlationId: entry.correlationId,
    denialReason: entry.denialReason,
    targetVersion: entry.targetVersion,
    currentVersion: entry.currentVersion,
    before: entry.before,
    after: entry.after,
  }
  return appendRuntimeLedgerEntry(ledgerRecord) ? ledgerRecord : null
}

export function loadOpenClawPolicyLedgerRecords(
  sessionId: string,
  correlationId: string,
): readonly OpenClawPolicyLedgerRecord[] {
  return loadRuntimeEventStoreRecords()
    .filter((record): record is RuntimeLedgerEntryRecord => record.kind === "ledger")
    .filter(isOpenClawPolicyLedgerRecord)
    .filter((record) => record.sessionId === sessionId && record.correlationId === correlationId)
}
