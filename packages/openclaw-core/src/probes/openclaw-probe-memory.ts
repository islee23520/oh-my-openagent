import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import {
  applyOpenClawMemoryAction,
  exportOpenClawMemorySnapshot,
  readOpenClawMemory,
  seedOpenClawMemory,
  type OpenClawMemoryAction,
  type OpenClawMemoryMutationResult,
} from "../openclaw-memory"

interface ProbeOptions {
  readonly seed: "safe-memory" | "canary"
  readonly actions: readonly OpenClawMemoryAction[]
  readonly auth: AuthInput
  readonly out?: string
  readonly expectLedger: boolean
  readonly readAll: boolean
  readonly exportAll: boolean
  readonly expectAbsent?: string
}

interface AuthInput {
  readonly kind: "none" | "bearer"
  readonly token?: string
}

interface ProbeEvidence {
  readonly ok: boolean
  readonly seed: ProbeOptions["seed"]
  readonly actions: readonly OpenClawMemoryMutationResult[]
  readonly memory: ReturnType<typeof readOpenClawMemory>
  readonly exportBody?: string
  readonly absentCheck?: {
    readonly absent: boolean
  }
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseAction(value: string): OpenClawMemoryAction {
  if (value === "pin" || value === "edit" || value === "delete" || value === "deny") return value
  throw new Error(`unsupported memory action: ${value}`)
}

function parseActions(value: string | undefined): readonly OpenClawMemoryAction[] {
  if (value === undefined || value.length === 0) return []
  return value.split(",").map(parseAction)
}

function parseSeed(value: string | undefined): ProbeOptions["seed"] {
  if (value === "safe-memory" || value === "canary") return value
  throw new Error(`unsupported --seed: ${value ?? ""}`)
}

function parseAuth(value: string | undefined): AuthInput {
  if (value === "none") return { kind: "none" }
  const prefix = "bearer:"
  if (value?.startsWith(prefix)) return { kind: "bearer", token: value.slice(prefix.length) }
  throw new Error(`unsupported --auth: ${value ?? ""}`)
}

function parseOptions(args: readonly string[]): ProbeOptions {
  return {
    seed: parseSeed(readFlag(args, "--seed")),
    actions: parseActions(readFlag(args, "--actions")),
    auth: parseAuth(readFlag(args, "--auth") ?? "none"),
    out: readFlag(args, "--out"),
    expectLedger: args.includes("--expect-ledger"),
    readAll: args.includes("--read-all"),
    exportAll: args.includes("--export-all"),
    expectAbsent: readFlag(args, "--expect-absent"),
  }
}

function resolveOutPath(out: string): string {
  return isAbsolute(out) ? out : resolve(out === ".omo" || out.startsWith(".omo/") ? join(process.cwd(), "../..", out) : out)
}

function writeEvidence(out: string, evidence: ProbeEvidence): void {
  const fullPath = resolveOutPath(out)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, `${JSON.stringify(evidence, null, 2)}\n`)
}

function actorFromEnv(): string {
  return process.env.OPENCLAW_TEST_ACTOR ?? "anonymous"
}

function buildEvidence(options: ProbeOptions): ProbeEvidence {
  let memory = seedOpenClawMemory(options.seed)
  const actions = options.actions.map((action) => {
    const result = applyOpenClawMemoryAction(memory, action, {
      actor: actorFromEnv(),
      bearerToken: options.auth.kind === "bearer" ? options.auth.token : undefined,
    })
    memory = result.memory
    return result
  })
  const exportBody = options.exportAll ? exportOpenClawMemorySnapshot() : undefined
  const combined = JSON.stringify({ memory: readOpenClawMemory(), exportBody })
  const absentCheck = options.expectAbsent === undefined
    ? undefined
    : { absent: !combined.includes(options.expectAbsent) }
  const ledgerOk = !options.expectLedger || actions.every((result) => result.ledgerId !== null)
  const absentOk = absentCheck === undefined || absentCheck.absent
  return {
    ok: ledgerOk && absentOk,
    seed: options.seed,
    actions,
    memory: options.readAll || options.actions.length > 0 ? readOpenClawMemory() : [],
    exportBody,
    absentCheck,
  }
}

function main(): void {
  const options = parseOptions(Bun.argv.slice(2))
  const evidence = buildEvidence(options)
  if (options.out !== undefined) writeEvidence(options.out, evidence)
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  process.exit(evidence.ok ? 0 : 1)
}

main()
