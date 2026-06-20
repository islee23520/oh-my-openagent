import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

type Verdict = "pass" | "fail"

interface RuleResult {
  readonly id: string
  readonly verdict: Verdict
  readonly files: readonly string[]
  readonly observations?: readonly string[]
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function git(args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], { encoding: "utf-8", maxBuffer: 96 * 1024 * 1024 })
  } catch (error) {
    if (error instanceof Error) return ""
    throw error
  }
}

function changedFiles(): readonly string[] {
  return git(["diff", "--name-only", "origin/dev...HEAD"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function isFinalVerifier(path: string): boolean {
  return /^scripts\/openclaw-(plan-compliance|review-diff|scope-fidelity)\.ts$/.test(path)
}

function diffFor(path: string): string {
  return git(["diff", "origin/dev...HEAD", "--", path])
}

function matchingFiles(paths: readonly string[], predicate: (path: string, diff: string) => boolean): readonly string[] {
  return paths.filter((path) => predicate(path, diffFor(path)))
}

function rule(id: string, files: readonly string[]): RuleResult {
  return { id, verdict: files.length === 0 ? "pass" : "fail", files }
}

function isDashboardRuntime(path: string): boolean {
  return (
    path.startsWith("packages/web/app/[locale]/openclaw/") ||
    path.startsWith("packages/web/components/openclaw/") ||
    path.startsWith("packages/web/lib/openclaw-read/")
  )
}

function writeJson(path: string, value: unknown): void {
  const fullPath = resolve(path)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`)
}

function main(): void {
  const out = readFlag(process.argv.slice(2), "--out")
  const paths = changedFiles()
  const evidenceChurn = paths.filter(
    (path) => path.startsWith(".omo/evidence/") && !path.startsWith(".omo/evidence/openclaw-control-plane/final-merge-loop/"),
  )
  const rules: readonly RuleResult[] = [
    rule("no-committed-omo-evidence-churn", evidenceChurn),
    rule(
      "no-dashboard-fake-data",
      matchingFiles(paths, (path, diff) => isDashboardRuntime(path) && /^\+.*\b(fake|mock|sampleData|placeholderData)\b/im.test(diff)),
    ),
    rule(
      "no-policy-bypass",
      matchingFiles(
        paths,
        (path, diff) => !isFinalVerifier(path) && /^\+.*\b(bypass|skipPolicy|forceAllow|policyDisabled|withoutAuth)\b/im.test(diff),
      ),
    ),
    rule(
      "no-memory-leakage",
      matchingFiles(paths, (path, diff) => path.startsWith(".omo/evidence/") && /^\+.*(OPENCLAW_[A-Z0-9_]*SECRET|bearer:raw-token|raw-token)/m.test(diff)),
    ),
    rule(
      "no-generated-churn",
      paths.filter((path) =>
        /(^|\/)(dist|node_modules|\.next|\.open-next|\.wrangler|coverage|playwright-report|test-results)\//.test(path),
      ),
    ),
  ]
  const verdict: Verdict = rules.every((entry) => entry.verdict === "pass") ? "pass" : "fail"
  const result = { gate: "F2-review-diff", verdict, base: "origin/dev...HEAD", changedFileCount: paths.length, rules }
  if (out !== undefined) writeJson(out, result)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(verdict === "pass" ? 0 : 1)
}

main()
