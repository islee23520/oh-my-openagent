import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { expect, test } from "@playwright/test"

const workspaceRoot = resolve(__dirname, "../../..")
const evidenceDir = join(
  workspaceRoot,
  ".omo/evidence/openclaw-control-plane/issues-10-12-13-governance",
)
const canary = "OPENCLAW_CANARY_SECRET_DO_NOT_LEAK"
const defaultScreenshot = join(evidenceDir, "issue-13-memory.png")
const defaultApiArtifact = join(evidenceDir, "issue-13-memory-api.json")

function dataHome(): string {
  const value = process.env.XDG_DATA_HOME
  expect(value).toBeTruthy()
  return value ?? ""
}

function evidencePath(value: string | undefined, fallback: string): string {
  if (value === undefined || value.length === 0) return fallback
  return value === ".omo" || value.startsWith(".omo/") ? join(workspaceRoot, value) : resolve(value)
}

function writeArtifact(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function seedMemory(): string {
  const memoryId = "mem-playwright-canary"
  const storePath = join(dataHome(), "opencode/storage/openclaw/memory-governance.jsonl")
  mkdirSync(dirname(storePath), { recursive: true })
  appendFileSync(
    storePath,
    `${JSON.stringify({
      kind: "memory",
      memoryId,
      summary: `Pinned preference ${canary} bearer:raw-token`,
      status: "active",
      pinned: true,
      sourceSessionId: "qa-memory-session",
      updatedAt: "2026-06-20T00:00:00.000Z",
    })}\n`,
    "utf-8",
  )
  return memoryId
}

test.describe("OpenClaw memory governance", () => {
  test("redacts governed memory in the API and dashboard", async ({ page, request }) => {
    const memoryId = seedMemory()

    const apiResponse = await request.get("/api/openclaw/memory")
    await expect(apiResponse).toBeOK()
    const apiBody = await apiResponse.text()
    writeArtifact(evidencePath(process.env.OPENCLAW_MEMORY_API_JSON, defaultApiArtifact), apiBody)
    expect(apiBody.includes(canary)).toBe(false)
    expect(apiBody.includes("bearer:raw-token")).toBe(false)
    expect(apiBody.includes("[redacted]")).toBe(true)

    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/en/openclaw", { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("openclaw-dashboard-ready")).toBeVisible()
    await expect(page.getByTestId(`memory-${memoryId}`)).toBeVisible()
    await expect(page.getByText("[redacted]").first()).toBeVisible()
    const bodyText = await page.locator("body").innerText()
    expect(bodyText.includes(canary)).toBe(false)
    expect(bodyText.includes("bearer:raw-token")).toBe(false)
    await page.screenshot({
      path: evidencePath(process.env.OPENCLAW_MEMORY_SCREENSHOT, defaultScreenshot),
      fullPage: true,
    })
  })
})
