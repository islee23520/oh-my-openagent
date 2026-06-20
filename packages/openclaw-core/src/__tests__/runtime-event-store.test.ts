import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getRuntimeEventStorePath } from "../event-store-paths"
import * as openclawModule from "../index"
import { dispatchOpenClawEvent } from "../runtime-dispatch"
import { resetRegistryPathCacheForTest } from "../session-registry-paths"
import type { OpenClawConfig } from "../types"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempDataHome = mkdtempSync(join(tmpdir(), "openclaw-runtime-store-"))
const probeScriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../openclaw-runtime-store-probe.ts",
)

function createConfig(): OpenClawConfig {
  return {
    enabled: true,
    gateways: {
      gateway: {
        type: "http",
        url: "https://example.com",
        method: "POST",
      },
    },
    hooks: {
      "session.created": { enabled: true, gateway: "gateway", instruction: "wake" },
    },
  }
}

beforeEach(() => {
  process.env.XDG_DATA_HOME = tempDataHome
  resetRegistryPathCacheForTest()
  const runtimeStoreDir = dirname(getRuntimeEventStorePath())
  rmSync(runtimeStoreDir, { recursive: true, force: true })
  mkdirSync(runtimeStoreDir, { recursive: true })
})

afterEach(() => {
  mock.restore()
})

afterAll(() => {
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalXdgDataHome
  resetRegistryPathCacheForTest()

  rmSync(tempDataHome, { recursive: true, force: true })
})

describe("runtime event store", () => {
  test("#given real wake dispatch #when a process restarts #then durable session run and event records survive", async () => {
    // given
    spyOn(openclawModule, "wakeOpenClaw").mockResolvedValue({
      gateway: "gateway",
      success: true,
      messageId: "msg-runtime-1",
      platform: "discord",
    })

    // when
    await dispatchOpenClawEvent({
      config: createConfig(),
      rawEvent: "session.created",
      context: {
        sessionId: "session-runtime-1",
        projectPath: "/tmp/openclaw-project",
        tmuxPaneId: "%42",
        tmuxSession: "openclaw-main",
      },
    })

    // then
    const runtimeStorePath = getRuntimeEventStorePath()
    expect(existsSync(runtimeStorePath)).toBe(true)
    const records = readFileSync(runtimeStorePath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records.map((record) => record.kind)).toContain("session")
    expect(records.map((record) => record.kind)).toContain("run")
    expect(records.map((record) => record.kind)).toContain("event")
    expect(records.find((record) => record.kind === "ledger")).toMatchObject({
      sessionId: "session-runtime-1",
      projectPath: "/tmp/openclaw-project",
      tmuxPaneId: "%42",
      tmuxSession: "openclaw-main",
      rawEvent: "session.created",
      openclawEvent: "session.created",
      status: "success",
      gateway: "gateway",
      messageId: "msg-runtime-1",
      platform: "discord",
    })
    const successLedger = records.find((record) => record.kind === "ledger")
    expect(typeof successLedger?.ledgerId).toBe("string")
    expect(typeof successLedger?.runId).toBe("string")
    expect(typeof successLedger?.createdAt).toBe("string")
    expect(records.find((record) => record.kind === "event")).toMatchObject({
      sessionId: "session-runtime-1",
      projectPath: "/tmp/openclaw-project",
      tmuxPaneId: "%42",
      tmuxSession: "openclaw-main",
      rawEvent: "session.created",
      openclawEvent: "session.created",
      sequence: 1,
    })
  })

  test("#given failed wake dispatch #when runtime store records the failure #then ledger and event records survive", async () => {
    // given
    spyOn(openclawModule, "wakeOpenClaw").mockResolvedValue({
      gateway: "gateway",
      success: false,
      error: "network timeout",
    })

    // when
    await dispatchOpenClawEvent({
      config: createConfig(),
      rawEvent: "session.created",
      context: {
        sessionId: "session-runtime-failure",
        projectPath: "/tmp/openclaw-project-failure",
        tmuxPaneId: "%7",
        tmuxSession: "openclaw-failure",
      },
    })

    // then
    const records = readFileSync(getRuntimeEventStorePath(), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records.find((record) => record.kind === "event")).toMatchObject({
      sessionId: "session-runtime-failure",
      rawEvent: "session.created",
      openclawEvent: "session.created",
      success: false,
    })
    expect(records.find((record) => record.kind === "ledger")).toMatchObject({
      sessionId: "session-runtime-failure",
      projectPath: "/tmp/openclaw-project-failure",
      tmuxPaneId: "%7",
      tmuxSession: "openclaw-failure",
      rawEvent: "session.created",
      openclawEvent: "session.created",
      status: "failure",
      gateway: "gateway",
      error: "network timeout",
    })
    const failureLedger = records.find((record) => record.kind === "ledger")
    expect(typeof failureLedger?.ledgerId).toBe("string")
    expect(typeof failureLedger?.runId).toBe("string")
    expect(typeof failureLedger?.createdAt).toBe("string")
  })

  test("#given runtime store probe #when reader process restarts #then artifact proves same durable ids", () => {
    // given
    const outPath = join(tempDataHome, "probe-restart-reader.json")

    // when
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        probeScriptPath,
        "--session",
        "probe-restart-test",
        "--events",
        "2",
        "--out",
        outPath,
      ],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })

    // then
    expect(result.exitCode).toBe(0)
    const artifact = JSON.parse(readFileSync(outPath, "utf-8")) as Record<string, unknown>
    const restartProof = artifact.restartProof as Record<string, unknown> | undefined
    expect(restartProof).toMatchObject({
      childExitCode: 0,
      sameIds: true,
      sameSequences: true,
    })
    expect(typeof restartProof?.childCommand).toBe("string")
    expect(typeof restartProof?.childOutput).toBe("string")
  })
})
