import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

type Verdict = "pass" | "fail"

interface IssueGate {
  readonly issue: string
  readonly label: string
  readonly branchFound: boolean
  readonly mergeFound: boolean
  readonly changedFiles: readonly string[]
  readonly evidenceFiles: readonly string[]
  readonly verdict: Verdict
}

const expectedIssues: readonly {
  readonly issue: string
  readonly label: string
  readonly change: RegExp
  readonly evidence: RegExp
}[] = [
  { issue: "8", label: "runtime event store", change: /openclaw-core\/src\/event-store/, evidence: /final-merge-loop\/runtime-store/ },
  { issue: "9", label: "dashboard read API", change: /packages\/web\/app\/api\/openclaw|packages\/web\/lib\/openclaw-read|openclaw-api\.spec/, evidence: /issues-9-11-api-envelopes/ },
  { issue: "10", label: "dashboard UI", change: /packages\/web\/(app\/\[locale\]\/openclaw|components\/openclaw|e2e\/openclaw-dashboard)/, evidence: /issue-10-dashboard|dashboard-validation|dashboard-correlation|openclaw-final-dashboard/ },
  { issue: "11", label: "typed envelopes", change: /openclaw-envelope|openclaw-dashboard-envelopes/, evidence: /issues-9-11-api-envelopes|openclaw-validation/ },
  { issue: "12", label: "policy audit ledger", change: /openclaw-policy|policy-ledger|openclaw-probe-policy/, evidence: /policy-green|policy-cleanup|issues-10-12-13-governance/ },
  { issue: "13", label: "memory governance", change: /openclaw-memory|memory\/route|openclaw-memory\.spec/, evidence: /memory-green|memory-cleanup|issue-13-memory/ },
  { issue: "14", label: "real workload validation", change: /openclaw-probe-workload|openclaw-validation\.spec/, evidence: /issue-14-validation|workload-green/ },
]

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function git(args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).trim()
  } catch (error) {
    if (error instanceof Error) return ""
    throw error
  }
}

function shellLines(command: string, args: readonly string[]): readonly string[] {
  try {
    return execFileSync(command, [...args], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch (error) {
    if (error instanceof Error) return []
    throw error
  }
}

function writeJson(path: string, value: unknown): void {
  const fullPath = resolve(path)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`)
}

function buildIssueGate(
  issue: (typeof expectedIssues)[number],
  refs: readonly string[],
  merges: readonly string[],
  changedFiles: readonly string[],
  evidenceFiles: readonly string[],
): IssueGate {
  const branchPattern = new RegExp(`issue-${issue.issue}[-/]`)
  const branchFound = refs.some((ref) => branchPattern.test(ref))
  const mergeFound = merges.some((merge) => branchPattern.test(merge))
  const issueChangedFiles = changedFiles.filter((path) => issue.change.test(path))
  const issueEvidenceFiles = evidenceFiles.filter((path) => issue.evidence.test(path))
  const verdict: Verdict =
    branchFound && mergeFound && issueChangedFiles.length > 0 && issueEvidenceFiles.length > 0 ? "pass" : "fail"
  return {
    issue: issue.issue,
    label: issue.label,
    branchFound,
    mergeFound,
    changedFiles: issueChangedFiles,
    evidenceFiles: issueEvidenceFiles,
    verdict,
  }
}

function main(): void {
  const out = readFlag(process.argv.slice(2), "--out")
  const refs = shellLines("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"])
  const merges = git(["log", "--oneline", "--merges", "origin/dev..HEAD"]).split("\n")
  const changedFiles = git(["diff", "--name-only", "origin/dev...HEAD"]).split("\n").filter((line) => line.length > 0)
  const evidenceFiles = shellLines("find", [".omo/evidence/openclaw-control-plane", "-type", "f"])
  const issues = expectedIssues.map((issue) => buildIssueGate(issue, refs, merges, changedFiles, evidenceFiles))
  const verdict: Verdict = issues.every((issue) => issue.verdict === "pass") ? "pass" : "fail"
  const result = {
    gate: "F1-plan-compliance",
    verdict,
    base: "origin/dev...HEAD",
    issues,
    missing: issues.filter((issue) => issue.verdict === "fail").map((issue) => issue.issue),
  }
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (out !== undefined) writeJson(out, result)
  process.stdout.write(text)
  process.exit(verdict === "pass" ? 0 : 1)
}

main()
