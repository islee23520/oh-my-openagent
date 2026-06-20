import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

type Verdict = "pass" | "fail"

const allowedScopes: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "openclaw-core", pattern: /^packages\/openclaw-core\// },
  { label: "openclaw-adapter-shims", pattern: /^packages\/omo-opencode\/src\/openclaw\// },
  { label: "web-openclaw-route", pattern: /^packages\/web\/app\/\[locale\]\/openclaw\// },
  { label: "web-openclaw-api", pattern: /^packages\/web\/app\/api\/openclaw\// },
  { label: "web-openclaw-components", pattern: /^packages\/web\/components\/openclaw\// },
  { label: "web-openclaw-read-model", pattern: /^packages\/web\/lib\/openclaw-read\// },
  { label: "web-openclaw-e2e", pattern: /^packages\/web\/e2e\/openclaw-.*(\.spec|fixtures)\.ts$/ },
  { label: "web-navigation-link", pattern: /^packages\/web\/components\/nav-header\.tsx$/ },
  { label: "web-localized-copy", pattern: /^packages\/web\/messages\/(en|ja|ko|zh)\.json$/ },
  { label: "openclaw-package-metadata", pattern: /^packages\/(web|openclaw-core)\/(package\.json|bun\.lock|tsconfig\.json)$/ },
  { label: "final-verification-scripts", pattern: /^scripts\/openclaw-(plan-compliance|review-diff|scope-fidelity)\.ts$/ },
]

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function git(args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 })
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

function scopeLabel(path: string): string | null {
  for (const scope of allowedScopes) {
    if (scope.pattern.test(path)) return scope.label
  }
  return null
}

function writeJson(path: string, value: unknown): void {
  const fullPath = resolve(path)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`)
}

function main(): void {
  const out = readFlag(process.argv.slice(2), "--out")
  const files = changedFiles()
  const scopedFiles = files.filter((path) => !path.startsWith(".omo/evidence/"))
  const evidenceObservations = files.filter((path) => path.startsWith(".omo/evidence/"))
  const allowed = scopedFiles.flatMap((path) => {
    const label = scopeLabel(path)
    return label === null ? [] : [{ path, label }]
  })
  const violations = scopedFiles.filter((path) => scopeLabel(path) === null)
  const verdict: Verdict = violations.length === 0 ? "pass" : "fail"
  const result = {
    gate: "F4-scope-fidelity",
    verdict,
    base: "origin/dev...HEAD",
    allowedScopes: allowedScopes.map((scope) => scope.label),
    allowed,
    violations,
    evidenceObservations,
  }
  if (out !== undefined) writeJson(out, result)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(verdict === "pass" ? 0 : 1)
}

main()
