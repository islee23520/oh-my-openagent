import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import {
  evaluateAndAuditOpenClawPolicy,
  type OpenClawPolicyAction,
  type OpenClawPolicyDecisionResult,
  type OpenClawPolicySnapshot,
  type OpenClawPolicyStatusCode,
} from "../openclaw-policy"
import {
  loadOpenClawPolicyLedgerRecords,
  type OpenClawPolicyLedgerRecord,
} from "../policy-ledger"

interface ProbeOptions {
  readonly action: OpenClawPolicyAction
  readonly sessionId: string
  readonly auth: AuthInput
  readonly expectStatus?: OpenClawPolicyStatusCode
  readonly expectLedgerDeny: boolean
  readonly out?: string
  readonly appendOut?: string
  readonly targetVersion: number
  readonly currentVersion: number
  readonly scope: string
  readonly runId: string
  readonly correlationId: string
}

interface AuthInput {
  readonly kind: "none" | "bearer"
  readonly token?: string
}

interface ProbeRecord {
  readonly ok: boolean
  readonly actor: string
  readonly action: OpenClawPolicyAction
  readonly decision: OpenClawPolicyDecisionResult["decision"]
  readonly scope: string
  readonly sessionId: string
  readonly runId: string
  readonly correlationId: string
  readonly statusCode: OpenClawPolicyStatusCode
  readonly denialReason?: OpenClawPolicyDecisionResult["denialReason"]
  readonly targetVersion?: number
  readonly currentVersion?: number
  readonly before?: OpenClawPolicySnapshot
  readonly after?: OpenClawPolicySnapshot
  readonly policyResult: OpenClawPolicyDecisionResult
  readonly ledgerRecord: OpenClawPolicyLedgerRecord
  readonly persistedLedgerRecords: readonly OpenClawPolicyLedgerRecord[]
}

interface ProbeEvidence {
  readonly records: readonly ProbeRecord[]
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseStatusCode(value: string | undefined): OpenClawPolicyStatusCode | undefined {
  if (value === undefined) return undefined
  switch (value) {
    case "200":
      return 200
    case "401":
      return 401
    case "403":
      return 403
    case "409":
      return 409
    default:
      throw new Error(`unsupported --expect-status: ${value}`)
  }
}

function parsePositiveVersion(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid version: ${value}`)
  }
  return parsed
}

function parseAction(value: string | undefined): OpenClawPolicyAction {
  if (value === "approve-run") return value
  throw new Error(`unsupported --action: ${value ?? ""}`)
}

function parseAuth(value: string | undefined): AuthInput {
  if (value === "none") return { kind: "none" }
  const prefix = "bearer:"
  if (value?.startsWith(prefix)) {
    return { kind: "bearer", token: value.slice(prefix.length) }
  }
  throw new Error(`unsupported --auth: ${value ?? ""}`)
}

function requiredFlag(args: readonly string[], flag: string): string {
  const value = readFlag(args, flag)
  if (value === undefined) throw new Error(`${flag} is required`)
  return value
}

function parseOptions(args: readonly string[]): ProbeOptions {
  const sessionId = requiredFlag(args, "--session")
  const currentVersion = parsePositiveVersion(readFlag(args, "--current-version"), 7)
  const targetVersion = parsePositiveVersion(
    readFlag(args, "--target-version"),
    args.includes("--stale") ? currentVersion - 1 : currentVersion,
  )
  return {
    action: parseAction(requiredFlag(args, "--action")),
    sessionId,
    auth: parseAuth(requiredFlag(args, "--auth")),
    expectStatus: parseStatusCode(readFlag(args, "--expect-status")),
    expectLedgerDeny: args.includes("--expect-ledger-deny"),
    out: readFlag(args, "--out"),
    appendOut: readFlag(args, "--append-out"),
    targetVersion,
    currentVersion,
    scope: readFlag(args, "--scope") ?? "control-plane",
    runId: readFlag(args, "--run") ?? `${sessionId}-run-1`,
    correlationId: readFlag(args, "--correlation") ?? `${sessionId}-corr-1`,
  }
}

function resolveOutPath(out: string): string {
  return isAbsolute(out) ? out : resolve(out === ".omo" || out.startsWith(".omo/") ? join(process.cwd(), "../..", out) : out)
}

function readExistingEvidence(path: string): ProbeEvidence {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"))
    if (isProbeEvidence(parsed)) return parsed
    if (isProbeRecord(parsed)) return { records: [parsed] }
    return { records: [] }
  } catch (error) {
    if (error instanceof SyntaxError) return { records: [] }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { records: [] }
    throw error
  }
}

function isProbeEvidence(value: unknown): value is ProbeEvidence {
  return typeof value === "object"
    && value !== null
    && "records" in value
    && Array.isArray(value.records)
    && value.records.every(isProbeRecord)
}

function isProbeRecord(value: unknown): value is ProbeRecord {
  return typeof value === "object"
    && value !== null
    && "decision" in value
    && (value.decision === "allow" || value.decision === "deny")
}

function writeEvidence(out: string, evidence: ProbeEvidence): void {
  const fullPath = resolveOutPath(out)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, `${JSON.stringify(evidence, null, 2)}\n`)
}

function buildRecord(options: ProbeOptions): ProbeRecord {
  const before = { status: "waiting-approval", version: options.currentVersion } as const
  const after = { status: "approved", version: options.currentVersion + 1 } as const
  const actor = process.env.OPENCLAW_TEST_ACTOR ?? "anonymous"
  const auditResult = evaluateAndAuditOpenClawPolicy({
    actor,
    bearerToken: options.auth.kind === "bearer" ? options.auth.token : undefined,
    action: options.action,
    scope: options.scope,
    sessionId: options.sessionId,
    runId: options.runId,
    correlationId: options.correlationId,
    targetVersion: options.targetVersion,
    currentVersion: options.currentVersion,
    before,
    after,
  })
  const result = auditResult.policyResult
  if (auditResult.ledgerRecord === null) {
    throw new Error("failed to append policy audit ledger record")
  }
  const persistedLedgerRecords = loadOpenClawPolicyLedgerRecords(result.sessionId, result.correlationId)
  return {
    ok: options.expectStatus === undefined ? result.decision === "allow" : result.statusCode === options.expectStatus,
    actor: result.actor,
    action: result.action,
    decision: result.decision,
    scope: result.scope,
    sessionId: result.sessionId,
    runId: result.runId,
    correlationId: result.correlationId,
    statusCode: result.statusCode,
    ...(result.denialReason !== undefined && { denialReason: result.denialReason }),
    ...(result.targetVersion !== undefined && { targetVersion: result.targetVersion }),
    ...(result.currentVersion !== undefined && { currentVersion: result.currentVersion }),
    ...(result.before !== undefined && { before: result.before }),
    ...(result.after !== undefined && { after: result.after }),
    policyResult: result,
    ledgerRecord: auditResult.ledgerRecord,
    persistedLedgerRecords,
  }
}

function applyOutput(options: ProbeOptions, record: ProbeRecord): ProbeEvidence {
  if (options.out === undefined && options.appendOut === undefined) {
    return { records: [record] }
  }

  if (options.out !== undefined) {
    const evidence = { records: [record] }
    writeEvidence(options.out, evidence)
    return evidence
  }

  const appendOut = options.appendOut
  if (appendOut === undefined) return { records: [record] }
  const fullPath = resolveOutPath(appendOut)
  const existing = readExistingEvidence(fullPath)
  const evidence = { records: [...existing.records, record] }
  writeEvidence(appendOut, evidence)
  return evidence
}

function hasDenialDecision(evidence: ProbeEvidence): boolean {
  return evidence.records.some((record) => record.persistedLedgerRecords.some((ledger) => ledger.decision === "deny"))
}

function main(): void {
  const options = parseOptions(Bun.argv.slice(2))
  const record = buildRecord(options)
  const evidence = applyOutput(options, record)
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)

  const statusMatches = options.expectStatus === undefined || record.statusCode === options.expectStatus
  const ledgerDenyMatches = !options.expectLedgerDeny || hasDenialDecision(evidence)
  process.exit(statusMatches && ledgerDenyMatches ? 0 : 1)
}

main()
