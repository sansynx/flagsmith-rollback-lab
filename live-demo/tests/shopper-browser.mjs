import assert from "node:assert/strict"
import { chromium } from "playwright"
import { AxeBuilder } from "@axe-core/playwright"

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const origin = process.env.BROWSER_URL ?? "http://127.0.0.1:4197"
try {
  for (const width of [320, 390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 800 : 960 }, isMobile: width < 500, hasTouch: width < 500 })
    const page = await ctx.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(origin + "/")
    await page.getByRole("link", { name: "Try the shopper checkout" }).click()
    await page.getByRole("button", { name: "Open demo checkout" }).click()
    const flag = page.getByRole("switch", { name: "checkout_v2" })
    await page.getByText("Flag on", { exact: true }).waitFor()
    const pay = page.getByRole("button", { name: "Pay $18.00", exact: true })
    if (width === 320) {
      await pay.click()
      await page.getByRole("heading", { name: "Order confirmed" }).waitFor()
    }
    await flag.click()
    await page.getByText(/New shoppers now get the old checkout/).waitFor()
    const submit = name => Promise.all([
      page.waitForResponse(res => res.url().endsWith("/api/scenarios/checkout/pay")),
      page.getByRole("button", { name, exact: true }).click(),
    ]).then(async ([res]) => ({ status: res.status(), body: await res.json() }))
    const failed = await submit("Pay $18.00")
    assert.equal(failed.status, 410)
    await page.getByText("Payment couldn’t go through").waitFor()
    await page.reload()
    const succeeded = await submit("Retry with protected rollback")
    assert.equal(succeeded.status, 201)
    assert.equal(succeeded.body.capturedAt, failed.body.capturedAt)
    assert.match(succeeded.body.receipt, /^[A-F0-9]{8}$/)
    const payRequest = { data: { capturedAt: failed.body.capturedAt, plan: "revised" }, headers: { "X-Rehearsal-Request": "run" } }
    const again = await ctx.request.post(origin + "/api/scenarios/checkout/pay", payRequest)
    assert.equal((await again.json()).receipt, succeeded.body.receipt)
    const outsider = await browser.newContext()
    assert.equal((await outsider.request.post(origin + "/api/scenarios/checkout/pay", payRequest)).status(), 409)
    await outsider.close()
    await page.reload()
    await page.getByText(new RegExp(succeeded.body.receipt)).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    assert.deepEqual((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations.map(v=>v.id), [])
    await page.screenshot({path: `.runtime/shopper-${width}.png`, fullPage:true})
    await page.getByRole("link", { name: "Inspect the rollback requests" }).click()
    await page.getByRole("tab", { name: "Revised plan" }).waitFor()
    assert.deepEqual(errors, [])
    await ctx.close()
    console.log(width + "px shopper: original 410, protected 201, receipt persisted and isolated")
  }
} finally {
  await browser.close()
}
