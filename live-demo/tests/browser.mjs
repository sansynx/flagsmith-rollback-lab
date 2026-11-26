import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { AxeBuilder } from "@axe-core/playwright"
import { chromium } from "playwright"

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const origin = process.env.BROWSER_URL ?? "http://127.0.0.1:4197"
await mkdir(".runtime", { recursive: true })
try {
  const scenarios = [
    ["Checkout", "checkout", 410, 201],
    ["Resumable upload", "upload", 409, 200],
    ["Booking hold", "booking", 409, 201],
    ["Report export", "export", 404, 200],
    ["Onboarding draft", "onboarding", 422, 200],
    ["Subscription quote", "quote", 412, 202],
  ]
  for (const width of [320, 390, 768, 1440]) {
    const phone = width < 640
    const context = await browser.newContext({ viewport: { width, height: phone ? 640 : 1040 }, isMobile: phone, hasTouch: phone, reducedMotion: width === 320 ? "reduce" : "no-preference", acceptDownloads: true })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()) })
    await page.goto(origin, { waitUntil: "networkidle", timeout: 25_000 })
    await page.getByRole("heading", { name: "Rollback Rehearsal" }).waitFor()
    await page.getByRole("heading", { name: "How it works" }).waitFor()
    const picker = page.getByRole("combobox", { name: "Choose a scenario" })
    const control = page.getByRole("switch", { name: "Flagsmith treatment switch" })
    await control.waitFor()
    if (phone) {
      await picker.waitFor()
      const box = await control.boundingBox()
      assert.ok(box.height >= 44 && box.y + box.height <= 640, "Switch fits on the first phone screen")
    } else {
      await page.getByRole("button", { name: "Subscription quote" }).waitFor()
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    if (width < 700) {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click()
      await page.getByRole("dialog", { name: "Sidebar" }).getByRole("link", { name: "How it works" }).click()
      await page.getByRole("dialog", { name: "Sidebar" }).waitFor({ state: "hidden" })
      assert.equal(new URL(page.url()).hash, "#how-it-works")
    }

    for (const [name, id, failed, succeeded] of width === 390 || width === 1440 ? scenarios : scenarios.slice(-1)) {
      if (phone) {
        await picker.tap()
        await page.getByRole("option", { name, exact: true }).tap()
      } else {
        await page.getByRole("button", { name, exact: true }).click()
      }
      assert.equal(await control.evaluate(el => getComputedStyle(el, "::before").opacity), "0")
      const waitToggle = () => page.waitForResponse(res => res.url().endsWith(`/api/scenarios/${id}/toggle`))
      const armResponse = waitToggle()
      await control.click()
      const armed = await armResponse
      assert.equal(armed.status(), 200)
      const state = await armed.json()
      assert.equal(state.assignment, "treatment")
      await page.getByText("Treatment session captured. Switch off to run the rehearsal.").waitFor()
      assert.equal(await control.getAttribute("aria-checked"), "true")
      assert.equal(await control.evaluate(el => getComputedStyle(el, "::before").opacity), "1")
      if (width === 320) assert.equal(await control.evaluate(el => getComputedStyle(el).transitionDuration), "0s")
      const runResponse = waitToggle()
      await control.click()
      const ran = await runResponse
      assert.equal(ran.status(), 200)
      const result = await ran.json()
      assert.equal(result.enabled, false)
      assert.equal(result.assignment, "control")
      assert.equal(result.evidence.original.steps.at(-1).httpStatus, failed)
      assert.equal(result.evidence.revised.steps.at(-2).httpStatus, succeeded)
      assert.equal(result.evidence.original.steps[0].capturedAt, state.opened.capturedAt)
      assert.equal(result.evidence.revised.steps[0].capturedAt, state.opened.capturedAt)
      assert.equal(result.evidence.original.steps[2].assignment, "control")
      assert.equal(result.evidence.revised.steps[2].assignment, "control")
      assert.deepEqual(result.evidence.original.final, result.evidence.revised.final)
      await page.locator('[data-slot="card-title"]').getByText(`HTTP ${failed}`, { exact: true }).waitFor()
      await page.locator('[data-slot="card-title"]').getByText(`HTTP ${succeeded}`, { exact: true }).waitFor()
      await page.getByRole("tab", { name: "Revised plan" }).click()
      if (phone) {
        const steps = page.getByRole("list", { name: "revised rollback steps" })
        assert.equal(await steps.getByRole("listitem").count(), result.evidence.revised.steps.length)
        await steps.getByRole("listitem").filter({ hasText: result.evidence.revised.steps.at(-2).action }).getByText(`HTTP ${succeeded}`).waitFor()
      } else {
        await page.getByRole("table", { name: "revised rollback evidence" }).waitFor()
      }
      console.log(`${width}px ${id}: Flagsmith on/off, ${failed} → ${succeeded}`)
    }

    const downloadEvent = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download evidence" }).click()
    assert.match((await downloadEvent).suggestedFilename(), /^rollback-.*-evidence\.json$/)
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
    assert.deepEqual(accessibility.violations.map(v => ({ rule: v.id, targets: v.nodes.map(n => n.target) })), [])
    assert.deepEqual(errors, [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `.runtime/dashboard-${width}.png`, fullPage: true })
    await context.close()
  }

  // Two browsers can use the same scenario without changing each other's live Flagsmith assignment.
  const left = await browser.newContext()
  const right = await browser.newContext()
  const toggle = (context, enabled) => context.request.post(origin + "/api/scenarios/checkout/toggle", {
    headers: { "X-Rehearsal-Request": "run" }, data: { enabled },
  })
  for (const context of [left, right]) assert.equal((await toggle(context, true)).status(), 200)
  assert.equal((await toggle(left, false)).status(), 200)
  const rightSession = await (await right.request.get(origin + "/api/session")).json()
  assert.equal(rightSession.checkout.enabled, true)
  // A repeated ON reads Flagsmith without writing, so this also checks the live assignment.
  const rightStillOn = await toggle(right, true)
  assert.equal(rightStillOn.status(), 200)
  assert.equal((await rightStillOn.json()).assignment, "treatment")
  const rightRun = await (await toggle(right, false)).json()
  assert.equal(rightRun.evidence.original.steps.at(-1).httpStatus, 410)
  console.log("Independent reviewer sandboxes verified")
  await left.close()
  await right.close()
} finally {
  await browser.close()
}
