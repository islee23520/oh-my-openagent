import { mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { expect, test } from "@playwright/test"

const workspaceRoot = resolve(__dirname, "../../..")
const defaultErrorScreenshot = resolve(
  workspaceRoot,
  ".omo/evidence/openclaw-control-plane/issues-10-12-13-governance/issue-10-dashboard-error.png",
)

function screenshotPath(): string {
  const configured = process.env.OPENCLAW_SCREENSHOT_ERROR
  if (configured === undefined || configured.length === 0) return defaultErrorScreenshot
  return configured === ".omo" || configured.startsWith(".omo/")
    ? join(workspaceRoot, configured)
    : resolve(configured)
}

test.describe("OpenClaw dashboard error state", () => {
  test.skip(
    process.env.OPENCLAW_FORCE_API_ERROR !== "1",
    "Set OPENCLAW_FORCE_API_ERROR=1 to exercise the forced API error path.",
  )

  test("keeps the shell visible when the read API returns an error", async ({ page }) => {
    const target = process.env.OPENCLAW_DASHBOARD_URL ?? "http://127.0.0.1:3000/en/openclaw"
    await page.goto(target, { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("heading", { name: /runtime sessions/i })).toBeVisible()
    await expect(page.getByTestId("openclaw-error")).toBeVisible()
    await expect(
      page.getByText(process.env.OPENCLAW_EXPECT_ERROR_TEXT ?? "OpenClaw data unavailable"),
    ).toBeVisible()
    const path = screenshotPath()
    mkdirSync(dirname(path), { recursive: true })
    await page.screenshot({ path, fullPage: true })
  })
})
