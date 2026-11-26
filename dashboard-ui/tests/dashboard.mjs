import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { AxeBuilder } from "@axe-core/playwright"
import { chromium } from "playwright"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const python = process.env.REHEARSAL_PYTHON || "python3"
const sample = join(repo, "examples", "checkout.json")
const snapshot = join(repo, "examples", "environment.json")

function cli(code, ...args) {
  try {
    execFileSync(python, ["-m", "rollout_rehearsal", ...args], { cwd: tmpdir(), stdio: "pipe", timeout: 15_000 })
  } catch (error) {
    if (error.status === code) return
    throw error
  }
  assert.equal(code, 0, "rehearsal unexpectedly passed")
}

async function checkAccessibility(page) {
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  assert.deepEqual(audit.violations.map(result => ({ rule: result.id, targets: result.nodes.map(node => node.target) })), [])
}

test("the shipped report works offline with keyboard, filters, paging, and responsive rows", { timeout: 90_000 }, async t => {
  const workspace = mkdtempSync(join(tmpdir(), "rehearsal-dashboard-"))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const runs = join(workspace, "runs")
  const dashboard = join(workspace, "dashboard.html")
  const passing = join(workspace, "passed.json")
  const passingPlan = JSON.parse(readFileSync(sample))
  passingPlan.edits = []
  writeFileSync(passing, JSON.stringify(passingPlan))
  const args = ["--snapshot", snapshot, "--save-receipts", runs, "--summary"]
  for (let index = 0; index < 8; index++) cli(0, passing, ...args)
  cli(1, sample, ...args)
  cli(2, sample, ...args, "--require-baseline", "0".repeat(64))
  for (let index = 0; index < 2; index++) cli(0, passing, ...args)
  cli(0, "dashboard", "--receipt-dir", runs, "--output", dashboard)

  const browser = await chromium.launch({ executablePath: process.env.DASHBOARD_CHROME })
  t.after(() => browser.close())
  for (const width of [320, 390, 768, 1024, 1440]) {
    await t.test(`${width}px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 980 }, offline: true })
      try {
        const page = await context.newPage()
        const errors = []
        const remote = []
        page.on("pageerror", error => errors.push(error.message))
        page.on("request", request => { if (/^https?:/.test(request.url())) remote.push(request.url()) })
        await page.goto(pathToFileURL(dashboard).href)
        await page.getByRole("heading", { name: "Rollout history" }).waitFor()
        await page.getByText("42 of 44 checks", { exact: true }).waitFor()
        assert.equal(await page.evaluate(async () => {
          await document.fonts.ready
          return [...document.fonts].some(font => font.family === "IBM Plex Sans" && font.status === "loaded")
        }), true)
        const reasons = page.getByRole("list", { name: "Evaluation reason changes" })
        await reasons.getByText("Targeting match", { exact: true }).waitFor()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
        assert.equal(await page.getByRole("table", { name: "Rehearsal runs" }).isVisible(), width >= 768)
        assert.equal(await page.getByRole("list", { name: "Rehearsal runs" }).isVisible(), width < 768)
        const chart = page.getByRole("region", { name: "Checks by run" })
        assert.equal(await chart.getByRole("button").count(), 8)
        const blockedBar = chart.getByRole("button", { name: /Blocked/ })
        await blockedBar.focus()
        await page.keyboard.press("Enter")
        assert.equal(await blockedBar.getAttribute("aria-pressed"), "true")
        await chart.getByText("Blocked · no verdict recorded", { exact: true }).waitFor()
        const failedBar = chart.getByRole("button", { name: /2 passed, 2 failed/ })
        await failedBar.click()
        await chart.getByText("2 passed · 2 failed", { exact: true }).waitFor()
        await checkAccessibility(page)

        const next = page.getByRole("button", { name: "Next page" })
        await next.focus()
        await page.keyboard.press("Enter")
        await page.getByText("11–12 of 12 runs", { exact: true }).waitFor()
        assert.equal(await next.getAttribute("aria-disabled"), "true")
        assert.equal(await next.evaluate(el => el === document.activeElement), true)
        await page.keyboard.press("Enter")
        assert.equal(await page.getByRole("status").innerText(), "11–12 of 12 runs")

        const filter = page.getByRole("group", { name: "Filter by verdict" })
        await filter.getByRole("button", { name: "Failed", exact: true }).click()
        await page.getByText("1–1 of 1 run", { exact: true }).waitFor()
        assert.equal(await filter.getByRole("button", { name: "Failed", exact: true }).getAttribute("aria-pressed"), "true")
        const details = page.getByRole("button", { name: /Details for .*Failed/ })
        await details.focus()
        await page.keyboard.press("Enter")
        const dialog = page.getByRole("dialog", { name: "Run details" })
        await dialog.getByText("Default → Targeting match", { exact: true }).waitFor()
        assert.match(await dialog.locator("code").textContent(), /^[0-9a-f]{64}$/)
        await checkAccessibility(page)
        await page.keyboard.press("Escape")
        await dialog.waitFor({ state: "hidden" })
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.includes("Failed"))
        await filter.getByRole("button", { name: "Blocked", exact: true }).click()
        await page.getByRole("button", { name: /Details for .*Blocked/ }).click()
        await dialog.getByText(/produced no verdict/).waitFor()
        assert.equal(await dialog.locator("code").count(), 0)
        assert.deepEqual(errors, [])
        assert.deepEqual(remote, [])
      } finally {
        await context.close()
      }
    })
  }

  const empty = join(workspace, "empty")
  mkdirSync(empty)
  cli(0, "dashboard", "--receipt-dir", empty, "--output", dashboard)
  const page = await browser.newPage()
  await page.goto(pathToFileURL(dashboard).href)
  await page.getByText("No rehearsals recorded", { exact: true }).waitFor()

  const large = join(workspace, "large")
  mkdirSync(large)
  const filename = readdirSync(runs).sort().at(-1)
  const receipt = readFileSync(join(runs, filename), "utf8")
    .replace(/"passed":4/, '"passed":9223372036854775807')
    .replace(/"duration_ms":\d+/, '"duration_ms":9223372036854775807')
  writeFileSync(join(large, filename), receipt)
  cli(0, "dashboard", "--receipt-dir", large, "--output", dashboard)
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 980 })
    await page.goto(pathToFileURL(dashboard).href)
    await page.locator("main").getByText("9,223,372,036,854,775,807 of 9,223,372,036,854,775,807 checks", { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    if (width === 768) {
      const scroll = await page.locator("[data-slot=table-container]").evaluate(el => el.scrollWidth - el.clientWidth)
      assert.equal(scroll, 0, "table columns should remain visible at tablet width")
    }
  }
})
