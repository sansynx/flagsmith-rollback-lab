import { useEffect, useState } from "react"
import { IconArrowRight, IconBolt, IconBook2, IconCheck, IconCreditCard, IconShoppingBag } from "@tabler/icons-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useLiveView } from "@/lib/live-view"

type Cart = { assignment: "control" | "treatment"; payment?: { status: number; receipt?: string } }
type Shop = { enabled: boolean; changing: boolean; unverified: boolean; cart: Cart | null }
const newCartId = () => crypto.randomUUID().replaceAll("-", "")

export function Storefront({ room }: { room: string }) {
  const storage = "field-notes-cart-" + room
  const [id, setId] = useState(() => {
    try { return sessionStorage.getItem(storage) || newCartId() } catch { return newCartId() }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [reviewed, setReviewed] = useState(false)
  const url = "/api/shop/" + encodeURIComponent(room)
  const live = useLiveView<Shop>(url, "X-Shop-Cart", id, busy)
  const state = live.data
  const cart = state?.cart
  const payment = cart?.payment
  const express = state?.enabled
  const expressOrder = cart?.assignment === "treatment"
  const disabled = busy || !state || state.changing || state.unverified || Boolean(live.error)
  useEffect(() => {
    document.title = "Field Notes Press · Shop"
    try { sessionStorage.setItem(storage, id) } catch { /* in-memory cart still works */ }
  }, [storage,id])

  async function submit(action: "open" | "pay") {
    if (disabled) return
    setError("")
    setBusy(true)
    try {
      const res = await fetch(url + "/" + action, { method: "POST", headers: { "X-Shop-Cart": id, "X-Rehearsal-Request": "run" } })
      const body = await res.json()
      if (!res.ok && !(res.status === 410 && body.cart?.payment?.status === 410)) throw new Error(body.message ?? "Please try again.")
      live.setData(body)
    } catch (err) { setError(err instanceof Error ? err.message : "Could not reach the shop.") }
    finally { setBusy(false) }
  }

  function backToShop() {
    setId(newCartId())
    setReviewed(false)
    setError("")
    if (state) live.setData({ ...state, cart: null })
  }

  return <main className="mx-auto max-w-5xl space-y-6 px-4 pb-12 sm:px-8">
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b py-2">
      <div className="flex items-center gap-2 font-heading text-lg font-semibold"><IconBook2 className="size-5" />Field Notes Press</div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><IconShoppingBag className="size-4" />{cart && !payment ? "1 item" : "Bookshop"}</div>
    </header>
    {(live.error || error) && <Alert variant="destructive"><AlertTitle>Shop connection</AlertTitle><AlertDescription>{error || live.error}</AlertDescription></Alert>}
    {!state ? <p role="status" className="text-sm text-muted-foreground">{live.error ? "Waiting for a valid shop connection." : "Opening the shop…"}</p> :
      <>
        <p role="status" className={`rounded-md border px-4 py-3 text-sm font-medium ${express ? "border-primary/50 bg-primary/10 text-primary" : "border-chart-2/40 bg-chart-2/10 text-chart-2"}`}>
          {state.unverified ? "Checking checkout availability…" : express ? "Express checkout is available · Pay with your saved demo card" : "Standard checkout · Review your order before payment"}
        </p>
        {!cart ? <section className="grid items-stretch gap-5 sm:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
          <div aria-hidden="true" className="flex min-h-44 items-center justify-center rounded-xl border bg-muted p-5 sm:min-h-80">
            <div className="flex aspect-3/4 w-28 flex-col justify-between rounded-r-md border-l-8 border-black/25 bg-chart-2 p-3 text-background shadow-lg sm:w-44 sm:p-5">
              <IconBook2 className="size-5" /><span className="font-heading text-xl leading-none font-bold sm:text-3xl">The Release Field Guide</span><span className="font-mono text-[9px]">FIELD NOTES PRESS</span>
            </div>
          </div>
          <Card><CardHeader><CardDescription>Digital edition</CardDescription><CardTitle><h1 className="font-heading text-3xl font-semibold">The Release Field Guide</h1></CardTitle></CardHeader>
            <CardContent className="gap-4"><p className="text-sm text-muted-foreground">A pocket guide to shipping software, running small rollouts, and bringing a release back safely.</p>
              <Separator /><p className="font-mono text-2xl">$18.00</p>
              <Button className="min-h-11" variant={express ? "default" : "outline"} disabled={disabled} onClick={() => submit("open")}>{express ? <IconBolt /> : <IconShoppingBag />}{express ? "Start express checkout" : "Start standard checkout"}</Button>
              <p className="text-xs text-muted-foreground">Demo store · Test payments only</p>
            </CardContent></Card>
        </section> : <section className="mx-auto max-w-xl">
          <Card><CardHeader><Badge variant="outline">{expressOrder ? "Express order" : "Standard order"}</Badge>
            <CardTitle><h1 className="font-heading text-3xl font-semibold">{payment?.receipt ? "Order confirmed" : payment ? "Payment couldn’t go through" : expressOrder ? "Express checkout" : reviewed ? "Payment" : "Review your order"}</h1></CardTitle>
            {expressOrder !== express && !payment && <CardDescription>Your order opened in {expressOrder ? "express" : "standard"} checkout. New orders now use {express ? "express" : "standard"} checkout.</CardDescription>}
          </CardHeader>
          <CardContent className="gap-4"><div className="flex items-start justify-between gap-4"><div><p className="font-medium">The Release Field Guide</p><p className="text-sm text-muted-foreground">Digital edition · 1 copy</p></div><span className="font-mono">$18.00</span></div><Separator />
            {payment ? <>
              {payment.receipt ? <Alert role="status"><IconCheck /><AlertTitle>Payment received</AlertTitle><AlertDescription>Demo receipt {payment.receipt}</AlertDescription></Alert> :
                <Alert variant="destructive"><AlertTitle>The express payment service closed</AlertTitle><AlertDescription>Your test card was not charged. Return to the shop to start a new order.</AlertDescription></Alert>}
              <Button variant="outline" className="min-h-11" onClick={backToShop}>Back to shop</Button>
            </> : <>
              {(expressOrder || reviewed) && <div className="flex items-center gap-3 rounded-lg border p-3"><IconCreditCard className="size-5" /><div className="text-sm"><p>{expressOrder ? "Saved demo Visa" : "Test payment card"} ···· 4242</p><p className="text-xs text-muted-foreground">Test payments only</p></div></div>}
              {expressOrder || reviewed ? <Button className="min-h-11" disabled={disabled} onClick={() => submit("pay")}>Pay $18.00</Button> : <Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => setReviewed(true)}>Continue to payment <IconArrowRight /></Button>}
            </>}
          </CardContent></Card>
        </section>}
      </>}
  </main>
}
