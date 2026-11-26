import { useEffect, useState } from "react"
import { IconArrowLeft, IconBook2, IconCheck, IconCreditCard, IconFlag, IconShoppingBag } from "@tabler/icons-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { read, useSessionHeaders } from "@/lib/sandbox"
import type { Payment, PaymentPlan, ScenarioState } from "@/evidence"

const idle: ScenarioState = { enabled: false, assignment: "control" }
const price = "$18.00"

export function Checkout() {
  const headers = useSessionHeaders()
  const [state, setState] = useState<ScenarioState>(idle)
  const [busy, setBusy] = useState<string | null>("Loading checkout…")
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const capturedAt = state.opened?.capturedAt ?? state.evidence?.original.steps[0]?.capturedAt
  const payments = state.payments
  const payment = state.enabled ? payments?.live : payments?.revised ?? payments?.original
  const declined = payment?.status === 410

  async function refresh() {
    const session = await read<Record<string, ScenarioState>>("/api/session", { headers })
    setState(session.checkout ?? idle)
    setReady(true)
  }

  useEffect(() => {
    document.title = "Shopper checkout · Rollback Rehearsal"
    void act("Loading checkout…", refresh)
  }, [])

  async function act(message: string, action: () => Promise<void>) {
    setBusy(message)
    setError("")
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sandbox could not be reached.")
    } finally {
      setBusy(null)
    }
  }

  function toggle(enabled: boolean) {
    if (busy || !ready) return
    void act(enabled ? "Opening checkout…" : "Rehearsing the rollback…", async () => {
      setState(await read<ScenarioState>("/api/scenarios/checkout/toggle", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json", "X-Rehearsal-Request": "run" },
        body: JSON.stringify({ enabled }),
      }))
    })
  }

  function pay() {
    if (!capturedAt || busy) return
    const plan: PaymentPlan = state.enabled ? "live" : declined ? "revised" : "original"
    void act("Submitting test payment…", async () => {
      const res = await fetch("/api/scenarios/checkout/pay", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json", "X-Rehearsal-Request": "run" },
        body: JSON.stringify({ plan, capturedAt }),
      })
      const body = await res.json()
      if (body.plan !== plan || body.capturedAt !== capturedAt || (res.status !== 201 && res.status !== 410)) {
        throw new Error(body.message ?? "Unable to submit the test payment. Refresh the checkout.")
      }
      setState(current => ({ ...current, payments: { ...current.payments, [plan]: body as Payment } }))
    })
  }

  const guide = state.recovery ? "Switch off again to verify the rollback."
    : state.enabled && payment?.receipt ? "Payment went through while the flag was on. Flip it off to replay this cart from just before the shopper paid."
    : state.enabled ? "The shopper has the new checkout open. Flip the flag off before pressing Pay to see what happens mid-order."
    : declined ? "The payment code retired too early. Retry the same order with the agent’s plan, which keeps that code available until payment finishes."
    : payment?.receipt ? "The protected checkout finished. Switch on to start a new order."
    : state.evidence ? "New shoppers now get the old checkout. This shopper still has the new one open. Press Pay to try the original rollback."
    : "Switch on to open the shopper’s new checkout. Then turn the flag off while the cart is still open."

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-12 sm:space-y-7 sm:px-8">
      <nav className="flex min-h-14 items-center justify-between gap-2 border-b">
        <Button asChild variant="ghost" className="-ml-2 min-h-11"><a href="/"><IconArrowLeft />Rollback lab</a></Button>
        <Button asChild variant="outline"><a href="/presenter">Present the live shop</a></Button>
      </nav>
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Shopper checkout</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">You have a book in your cart. Can you still buy it if the team rolls back checkout before you pay?</p>
      </header>
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-6">
        <aside aria-labelledby="rehearsal-heading">
          <Card>
            <CardHeader>
              <CardTitle><h2 id="rehearsal-heading" className="flex items-center gap-2 font-heading text-lg"><IconFlag className="size-5 text-primary" />Rehearsal controls</h2></CardTitle>
              <CardDescription>Play the release engineer here and the shopper at the register.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3">
                <div><label htmlFor="treatment-switch" className="block font-mono text-sm">checkout_v2</label><span className="text-xs text-muted-foreground">{state.recovery ? "Unverified" : state.enabled ? "Flag on" : "Flag off"}</span></div>
                <Switch id="treatment-switch" className="event-switch" checked={state.enabled} onCheckedChange={toggle}
                  aria-disabled={Boolean(busy) || !ready} aria-describedby="checkout-guide" />
              </div>
              <p id="checkout-guide" role="status" className="text-sm leading-relaxed">{busy ?? guide}</p>
              {error && <Alert variant="destructive"><AlertTitle>Checkout needs attention</AlertTitle>
                <AlertDescription>{error}</AlertDescription><Button variant="outline" className="mt-2" onClick={() => void act("Loading checkout…", refresh)}>Refresh checkout</Button></Alert>}
              {state.evidence && <a className="text-sm text-primary underline underline-offset-4" href="/#evidence">Inspect the rollback requests</a>}
            </CardContent>
          </Card>
        </aside>
        <section aria-labelledby="order-heading">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><IconShoppingBag className="size-4" />Field Notes Press</div>
              <CardTitle><h2 className="font-heading text-2xl" id="order-heading">{payment?.receipt ? "Order confirmed" : "Your order"}</h2></CardTitle>
            </CardHeader>
            <CardContent className="gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-15 shrink-0 items-center justify-center rounded-r-md border-l-4 border-primary bg-primary/20 text-primary" aria-hidden="true"><IconBook2 className="size-8" /></div>
                <div className="min-w-0"><p className="font-heading text-lg font-semibold">The Release Field Guide</p><p className="text-sm text-muted-foreground">Digital edition · 1 copy</p></div>
              </div>
              <Separator />
              <div className="flex justify-between gap-2 font-medium"><span>Total</span><span className="font-mono">{price}</span></div>
              <div className="flex items-center gap-3 rounded-lg border p-3"><IconCreditCard className="size-5 shrink-0 text-muted-foreground" /><div className="text-sm"><p>Demo Visa ···· 4242</p><p className="text-xs text-muted-foreground">Test payments only</p></div></div>
              {declined && <Alert variant="destructive"><AlertTitle>Payment couldn’t go through</AlertTitle><AlertDescription>Your cart is saved. The payment service for this checkout closed before you paid.</AlertDescription></Alert>}
              {payment?.receipt
                ? <Alert role="status"><IconCheck /><AlertTitle>Payment received</AlertTitle><AlertDescription>Demo receipt {payment.receipt} · {price}</AlertDescription></Alert>
                : capturedAt
                  ? <Button className="min-h-11 whitespace-normal" disabled={Boolean(busy) || state.recovery} onClick={pay}>{declined ? "Retry with protected rollback" : "Pay " + price}</Button>
                  : <Button className="min-h-11" disabled={Boolean(busy) || !ready} onClick={() => toggle(true)}>Open demo checkout</Button>}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}
