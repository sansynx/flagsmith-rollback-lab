import { useEffect, useState } from "react"
import { IconArrowLeft, IconCopy, IconExternalLink, IconFlag } from "@tabler/icons-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useLiveView } from "@/lib/live-view"
import { read, useSessionHeaders } from "@/lib/sandbox"

type Status = { enabled: boolean; changing: boolean; unverified: boolean; connected: boolean; open: number; paid: number; failed: number }

export function Presenter() {
  const headers = useSessionHeaders()
  const [path, setPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [policy, setPolicy] = useState("protected")
  const live = useLiveView<Status>(path ? "/api/presenter/status" : null, "X-Rehearsal-Session", headers["X-Rehearsal-Session"], busy)
  const state = live.data
  const shopUrl = path ? location.origin + path : ""
  async function connect() {
    setError("")
    try {
      const result = await read<{ path: string }>("/api/presenter/shop", { method: "POST", headers: { ...headers, "X-Rehearsal-Request": "run" } })
      setPath(result.path)
      live.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : "Could not open the shop.") }
  }
  useEffect(() => { document.title = "Presenter · Rollback Rehearsal"; void connect() }, [])
  async function toggle(enabled: boolean) {
    if (busy || !state || state.changing) return
    setBusy(true)
    setError("")
    try {
      await read("/api/scenarios/checkout/toggle", { method: "POST", headers: { ...headers, "Content-Type": "application/json", "X-Rehearsal-Request": "run" }, body: JSON.stringify({ enabled, policy }) })
      live.setData({ ...state, enabled, unverified: false })
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update the flag.") }
    finally { setBusy(false) }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(shopUrl); setCopied(true) }
    catch { setError("Copy the shop address using the link below.") }
  }
  return <main className="mx-auto max-w-3xl space-y-5 px-4 pb-12 sm:px-8">
    <nav className="flex h-14 items-center justify-between border-b"><Button asChild variant="ghost"><a href="/"><IconArrowLeft />Rollback lab</a></Button><Badge variant="outline">Presenter</Badge></nav>
    <header><h1 className="font-heading text-3xl font-semibold sm:text-4xl">Live shop demo</h1><p className="mt-2 text-sm text-muted-foreground">Put the shop on a second screen. Flip the switch here and watch its checkout change there.</p></header>
    <Card><CardHeader><CardTitle><h2>Shopper screen</h2></CardTitle><CardDescription>Open the paired store in a second window, or copy its link to a phone.</CardDescription></CardHeader>
      <CardContent><div className="flex flex-wrap items-center gap-2">
        {path && <Button asChild className="min-h-11"><a href={path} target="_blank" rel="noopener noreferrer">Open live shop <IconExternalLink /></a></Button>}
        <Button variant="outline" disabled={!path} className="min-h-11" onClick={copyLink}><IconCopy />{copied ? "Link copied" : "Copy shop link"}</Button>
      </div><p className="text-sm text-muted-foreground" role="status">{state?.connected ? "Shop connected" : "Waiting for the shop to open"}</p></CardContent>
    </Card>
    <Card><CardHeader><CardTitle><h2 className="flex items-center gap-2"><IconFlag className="size-4 text-primary" />Checkout release</h2></CardTitle></CardHeader>
      <CardContent className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <div><label htmlFor="treatment-switch" className="font-mono text-sm">checkout_v2</label><p className="text-sm text-muted-foreground" role="status">{busy || state?.changing ? "Updating Flagsmith…" : state?.unverified ? "Assignment unverified" : !state ? "Connecting…" : state.enabled ? "On · Express checkout" : "Off · Standard checkout"}</p></div>
          <Switch id="treatment-switch" className="event-switch" checked={state?.enabled ?? false} onCheckedChange={toggle} aria-disabled={busy || !state || state.changing} />
        </div>
        <div className="space-y-1.5"><label htmlFor="retirement" className="text-sm font-medium">When I switch off</label>
          <Select value={policy} onValueChange={setPolicy} disabled={busy}><SelectTrigger id="retirement" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="protected">Let open orders finish</SelectItem><SelectItem value="immediate">Retire express checkout immediately</SelectItem></SelectContent></Select>
        </div>
        <p className="text-sm text-muted-foreground">For the rollback demo, switch on and start an express order in the shop. Switch off here, then press Pay in the shop.</p>
      </CardContent></Card>
    {state && <Card><CardHeader><CardTitle><h2>Shop activity</h2></CardTitle></CardHeader><CardContent><dl className="grid grid-cols-3 gap-2">{[["Open",state.open],["Paid",state.paid],["Failed",state.failed]].map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="font-mono text-2xl">{value}</dd></div>)}</dl></CardContent></Card>}
    {(error || live.error) && <Alert><AlertDescription>{error || live.error}</AlertDescription><Button variant="outline" onClick={connect}>Reconnect presenter</Button></Alert>}
  </main>
}
