import assert from "node:assert/strict"
import { chromium } from "playwright"
import { AxeBuilder } from "@axe-core/playwright"

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const origin = process.env.BROWSER_URL ?? "http://127.0.0.1:4197"
try {
  const pageInSeparateBrowser = async options => (await browser.newContext(options)).newPage()
  const presenter = await pageInSeparateBrowser({viewport:{width:1152,height:900}})
  const shop = await pageInSeparateBrowser({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  const other = await pageInSeparateBrowser({viewport:{width:320,height:740},isMobile:true,hasTouch:true})
  const independent = await pageInSeparateBrowser()
  const errors = []
  for (const p of [presenter, shop, other, independent]) p.on("pageerror", err => errors.push(err.message))
  await presenter.goto(origin + "/presenter")
  const link = presenter.getByRole("link", {name:"Open live shop"})
  await link.waitFor()
  const shopUrl = new URL(await link.getAttribute("href"), origin).toString()
  await shop.goto(shopUrl)
  const navigationStart = await shop.evaluate(() => performance.timeOrigin)
  const button = (p,name) => p.getByRole("button",{name,exact:true})
  const flag = presenter.getByRole("switch",{name:"checkout_v2"})
  const flip = async enabled => {
    await Promise.all([presenter.waitForResponse(res => res.url().endsWith("/checkout/toggle") && res.status() === 200), flag.click()])
    await presenter.getByText(enabled ? "On · Express checkout" : "Off · Standard checkout",{exact:true}).waitFor()
  }
  await button(shop,"Start standard checkout").waitFor()
  assert.equal(await shop.getByRole("switch").count(),0)
  await presenter.getByText("Shop connected").waitFor()
  await independent.goto(origin+"/presenter")
  const secondLink = independent.getByRole("link",{name:"Open live shop"})
  await secondLink.waitFor()
  const otherUrl = new URL(await secondLink.getAttribute("href"),origin).toString()
  assert.notEqual(otherUrl,shopUrl)
  await independent.goto(otherUrl)
  await flip(true)
  await button(shop,"Start express checkout").waitFor()
  await shop.screenshot({path:".runtime/live-storefront-mobile.png",fullPage:true})
  await button(independent,"Start standard checkout").waitFor()
  await flip(false)
  await button(shop,"Start standard checkout").waitFor()
  assert.equal(await shop.evaluate(() => performance.timeOrigin), navigationStart)
  for (const protect of [true,false]) {
    if (!protect) {
      await presenter.getByRole("combobox",{name:"When I switch off"}).click()
      await presenter.getByRole("option",{name:"Retire express checkout immediately"}).click()
    }
    await flip(true)
    await button(shop,"Start express checkout").click()
    await shop.getByRole("heading",{name:"Express checkout"}).waitFor()
    await flip(false)
    await shop.getByText("Your order opened in express checkout. New orders now use standard checkout.").waitFor()
    if (protect) {
      await other.goto(shopUrl)
      await button(other,"Start standard checkout").click()
      await button(other,"Continue to payment").click()
      await button(other,"Pay $18.00").click()
      await other.getByRole("heading",{name:"Order confirmed"}).waitFor()
      assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth),320)
    }
    const [paid] = await Promise.all([shop.waitForResponse(res=>res.url().endsWith("/pay")),button(shop,"Pay $18.00").click()])
    assert.equal(paid.status(),protect ? 201 : 410)
    await shop.getByRole("heading",{name:protect ? "Order confirmed" : "Payment couldn’t go through"}).waitFor()
    await shop.reload()
    await shop.getByRole("heading",{name:protect ? "Order confirmed" : "Payment couldn’t go through"}).waitFor()
    await button(shop,"Back to shop").click()
    await button(shop,"Start standard checkout").waitFor()
  }
  await presenter.locator("dl div").filter({has:presenter.getByText("Paid",{exact:true})}).getByText("2",{exact:true}).waitFor()
  await presenter.locator("dl div").filter({has:presenter.getByText("Failed",{exact:true})}).getByText("1",{exact:true}).waitFor()
  for (const p of [presenter,shop]) {
    const a=await new AxeBuilder({page:p}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()
    assert.deepEqual(a.violations.map(v=>[v.id,v.nodes.map(n=>n.target)]),[])
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true)
  }
  assert.deepEqual(errors,[])
  console.log("Separate browser sessions: live OFF → ON → OFF without navigation, isolated shops, protected and immediate rollback, fresh standard orders, receipts, activity and accessibility passed.")
} finally {
  await browser.close()
}
