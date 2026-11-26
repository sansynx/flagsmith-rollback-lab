import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react"
import {
  IconCalendarEvent, IconCloudUpload, IconDownload, IconFileAnalytics, IconFlag, IconForms,
  IconGitBranch, IconReceipt2, IconShoppingCart, IconSparkles,
} from "@tabler/icons-react"
import { AppSidebar } from "@/components/app-sidebar"
import { SectionCards } from "@/components/section-cards"
import { SiteHeader } from "@/components/site-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Scenario, ScenarioState } from "@/evidence"

import { read, useSessionHeaders } from "@/lib/sandbox"

const ChartAreaInteractive = lazy(async () => ({ default: (await import("@/components/chart-area-interactive")).ChartAreaInteractive }))
const layout = { "--sidebar-width": "calc(var(--spacing) * 56)", "--header-height": "calc(var(--spacing) * 13)" } as CSSProperties
const icons = {
  checkout: IconShoppingCart, upload: IconCloudUpload, booking: IconCalendarEvent,
  export: IconFileAnalytics, onboarding: IconForms, quote: IconReceipt2,
}
const idle: ScenarioState = { enabled: false, assignment: "control" }

export function Dashboard() {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [states, setStates] = useState<Record<string, ScenarioState>>({})
  const [selected, setSelected] = useState("checkout")
  const [error, setError] = useState("")
  const sessionHeaders = useSessionHeaders()
  const [busy, setBusy] = useState<"loading" | "on" | "off" | null>("loading")
  const scenario = scenarios.find(item => item.id === selected)
  const state = states[selected] ?? idle
  const evidence = state.evidence

  useEffect(() => { void load() }, [])
  async function load() {
    setBusy("loading")
    setError("")
    try {
      const [scenarios, session] = await Promise.all([
        read<Scenario[]>("/api/scenarios"), read<Record<string, ScenarioState>>("/api/session", { headers: sessionHeaders }),
      ])
      setScenarios(scenarios)
      setStates(session)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn’t load the demo.")
    } finally {
      setBusy(null)
    }
  }

  async function toggle(enabled: boolean) {
    if (!scenario || busy) return
    const id = scenario.id
    setError("")
    setBusy(enabled ? "on" : "off")
    try {
      const result = await read<ScenarioState>(`/api/scenarios/${id}/toggle`, {
        method: "POST",
        headers: { ...sessionHeaders, "Content-Type": "application/json", "X-Rehearsal-Request": "run" },
        body: JSON.stringify({ enabled }),
      })
      setStates(current => ({ ...current, [id]: result }))
    } catch (error) {
      setError(error instanceof Error ? error.message : "The rehearsal couldn’t complete.")
      const current = await read<Record<string, ScenarioState>>("/api/session", { headers: sessionHeaders }).catch(() => undefined)
      if (current) setStates(current)
    } finally {
      setBusy(null)
    }
  }

  function chooseScenario(id: string) {
    setSelected(id)
    setError("")
  }

  function download() {
    if (!evidence) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2) + "\n"], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `rollback-${selected}-evidence.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const status = busy === "on" ? "Updating Flagsmith and opening a treatment session…"
    : busy === "off" ? "Switching to control and replaying both rollback plans…"
    : state.recovery ? "The live flag needs verification. Switch off to retry the saved session."
    : state.opened ? "Treatment session captured. Switch off to run the rehearsal."
    : evidence ? "Rehearsal verified. Switch on to try it again."
    : "Switch on to open a treatment session."

  return (
    <SidebarProvider style={layout}>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="@container/main flex min-w-0 flex-1 flex-col gap-3 py-4 sm:gap-6 sm:py-6">
          <section id="overview" className="flex flex-wrap items-end justify-between gap-3 px-4 lg:px-6" aria-labelledby="title">
            <div>
              <h1 id="title" className="font-heading text-3xl font-semibold tracking-tight md:text-4xl">Rollback Rehearsal</h1>
              <p className="mt-1 text-sm text-muted-foreground">Find out what happens to an open session when you turn its feature flag off.</p>
            </div>
            <Badge variant="outline"><IconFlag aria-hidden="true" />Self-hosted Flagsmith</Badge>
          </section>

          {error && (
            <div className="px-4 lg:px-6">
              <Alert variant="destructive" role="alert">
                <AlertTitle>Rehearsal unavailable</AlertTitle>
                <AlertDescription>{error}{!scenarios.length && <Button variant="outline" onClick={() => { void load() }}>Retry</Button>}</AlertDescription>
              </Alert>
            </div>
          )}

          <section className="px-4 lg:px-6" aria-labelledby="scenario-title">
            <Card>
              <CardHeader>
                <CardTitle><h2 id="scenario-title" className="font-heading text-xl">Choose a scenario</h2></CardTitle>
                <CardDescription className="hidden sm:block">Each scenario has its own flag in your sandbox.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="sm:hidden">
                  <Select value={selected} onValueChange={chooseScenario} disabled={Boolean(busy)}>
                    <SelectTrigger aria-labelledby="scenario-title" className="min-h-11 w-full"><SelectValue placeholder="Loading scenarios…" /></SelectTrigger>
                    <SelectContent position="popper">
                      {scenarios.map(item => <SelectItem key={item.id} value={item.id} className="min-h-11">{item.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="hidden grid-cols-2 gap-2 sm:grid @xl/main:grid-cols-3 @5xl/main:grid-cols-6">
                {scenarios.map(item => {
                  const Icon = icons[item.id as keyof typeof icons] ?? IconFlag
                  return (
                    <Button key={item.id} type="button" aria-pressed={item.id === selected}
                      variant={item.id === selected ? "default" : "outline"} className="min-h-11 justify-start gap-2 px-2.5 text-left whitespace-normal"
                      disabled={Boolean(busy)} onClick={() => chooseScenario(item.id)}>
                      <Icon aria-hidden="true" /><span>{item.title}</span>
                    </Button>
                  )
                })}
                </div>
              </CardContent>
            </Card>
          </section>

          {scenario && (
            <section className="px-4 lg:px-6" aria-labelledby="flag-title">
              <Card>
                <CardHeader>
                  <CardTitle><h2 id="flag-title" className="font-heading text-xl">{scenario.title}</h2></CardTitle>
                  <CardDescription>{scenario.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 rounded-lg border bg-muted/40 p-3 sm:p-4">
                    <div className="min-w-0 space-y-1">
                      <label htmlFor="treatment-switch" className="block text-sm font-medium">Flagsmith treatment switch</label>
                      <code className="block font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{scenario.flag}</code>
                      <Badge variant="outline" className={state.enabled ? "border-primary/50 text-primary" : "border-chart-2/50 text-chart-2"}>
                        {state.recovery ? "State unverified" : state.enabled ? "On · Treatment" : "Off · Control"}
                      </Badge>
                    </div>
                    <Switch id="treatment-switch" className="event-switch" checked={state.enabled} onCheckedChange={value => { void toggle(value) }}
                      aria-disabled={Boolean(busy)} aria-describedby="toggle-status" />
                    <p id="toggle-status" role="status" className="col-span-2 border-t pt-3 text-sm text-muted-foreground">{status}</p>
                  </div>
                  {selected === "checkout" && <Button asChild className="min-h-11 self-start"><a href="/presenter"><IconFlag />Present the live shop</a></Button>}
                  {selected === "checkout" && <Button asChild variant="outline" className="min-h-11 self-start"><a href="/checkout"><IconShoppingCart aria-hidden="true" />Try the shopper checkout</a></Button>}
                  {state.opened && (
                    <Alert><IconFlag aria-hidden="true" /><AlertTitle>{state.opened.action}</AlertTitle>
                      <AlertDescription>Flagsmith assigned <strong>treatment</strong>. The original session is waiting to finish.</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {evidence && <SectionCards evidence={evidence} />}

          <section id="how-it-works" className="scroll-mt-4 px-4 lg:px-6" aria-labelledby="how-title">
            <Card>
              <CardHeader>
                <CardTitle><h2 id="how-title" className="flex items-center gap-2 font-heading text-xl"><IconSparkles className="size-5 text-primary" aria-hidden="true" />How it works</h2></CardTitle>
                <CardDescription>No sign-in. The flag is real and the customer sessions are synthetic.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ol className="grid gap-3 text-sm @xl/main:grid-cols-3">
                  <li className="rounded-lg border p-3"><strong>1. Switch on</strong><p className="mt-1 text-muted-foreground">The app updates the local Flagsmith flag, reads the live assignment, and saves an open treatment session.</p></li>
                  <li className="rounded-lg border p-3"><strong>2. Switch off</strong><p className="mt-1 text-muted-foreground">A fresh visitor gets control. The agent tries retiring the handler while the captured session still needs it.</p></li>
                  <li className="rounded-lg border p-3"><strong>3. Compare the replays</strong><p className="mt-1 text-muted-foreground">The agent moves retirement after completion. The verifier compares actual HTTP responses and the final state.</p></li>
                </ol>
                <Button asChild variant="outline" size="sm"><a href="/demo.md"><IconSparkles aria-hidden="true" />Machine-readable demo guide</a></Button>
              </CardContent>
            </Card>
          </section>

          {evidence && (
            <>
              <div className="px-4 lg:px-6"><Suspense fallback={<Card><CardHeader><CardDescription>Loading chart…</CardDescription></CardHeader></Card>}><ChartAreaInteractive evidence={evidence} /></Suspense></div>
            </>
          )}
          <section id="evidence" className="scroll-mt-4 px-4 lg:px-6" aria-labelledby="evidence-title">
            <Card>
              <CardHeader>
                <CardTitle><h2 id="evidence-title" className="font-heading text-xl">Run evidence</h2></CardTitle>
                <CardDescription>{evidence ? "Compare the two plans and inspect each request." : "Turn the switch on, then off to record both outcomes here."}</CardDescription>
              </CardHeader>
              {evidence && (
                <CardContent>
                  <Tabs key={selected} defaultValue="original">
                    <TabsList aria-label="Rollback plans">
                      <TabsTrigger value="original">Original plan</TabsTrigger>
                      <TabsTrigger value="revised">Revised plan</TabsTrigger>
                    </TabsList>
                    {(["original", "revised"] as const).map(which => (
                      <TabsContent value={which} key={which}>
                        <ol aria-label={`${which} rollback steps`} className="space-y-3 sm:hidden">
                          {evidence[which].steps.map((step, index) => (
                            <li key={step.action} className="space-y-1 border-t pt-3 text-sm">
                              <strong>{index + 1}. {step.action}</strong>
                              {step.request && <code className="block break-all font-mono text-xs text-muted-foreground">{step.request}</code>}
                              <p>{step.result}</p>
                              <div className="flex flex-wrap items-center gap-2">
                                {step.httpStatus && <Badge variant={step.httpStatus >= 400 ? "destructive" : "secondary"}>HTTP {step.httpStatus}</Badge>}
                                {step.assignment && <Badge variant="outline">{step.assignment}</Badge>}
                                <span className="text-xs text-muted-foreground">{step.pendingTreatment} pending</span>
                              </div>
                            </li>
                          ))}
                        </ol>
                        <div className="hidden sm:block"><Table containerLabel={`${which} plan steps`} aria-label={`${which} rollback evidence`}>
                          <TableHeader><TableRow>
                            <TableHead scope="col">Step / request</TableHead>
                            <TableHead scope="col">Assignment / HTTP</TableHead>
                            <TableHead scope="col">Pending</TableHead>
                            <TableHead scope="col">Result</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>
                            {evidence[which].steps.map(step => (
                              <TableRow key={step.action}>
                                <TableCell className="font-medium">{step.action}{step.request && <code className="block font-mono text-xs text-muted-foreground">{step.request}</code>}</TableCell>
                                <TableCell>{step.assignment && <Badge variant="outline" className="mr-1">{step.assignment}</Badge>}{step.httpStatus && <Badge variant={step.httpStatus >= 400 ? "destructive" : "secondary"}>{step.httpStatus}</Badge>}{!step.assignment && !step.httpStatus && "—"}</TableCell>
                                <TableCell className="tabular-nums">{step.pendingTreatment}</TableCell>
                                <TableCell className="min-w-44 whitespace-normal">{step.result}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table></div>
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              )}
            </Card>
          </section>
          <section id="verify" className="scroll-mt-4 px-4 lg:px-6" aria-labelledby="verify-title">
            <Card>
              <CardHeader>
                <CardTitle><h2 id="verify-title" className="flex items-center gap-2 font-heading text-xl"><IconGitBranch className="size-4 text-primary" aria-hidden="true" />Agent proposal</h2></CardTitle>
                <CardDescription>{evidence ? "Verified in your sandbox." : "After a replay, see the retirement rule the agent derived."}</CardDescription>
              </CardHeader>
              {evidence && (
                <CardContent className="space-y-4">
                  <p className="text-sm font-medium">{evidence.rule}</p>
                  <p className="text-sm text-muted-foreground">{evidence.counterexample.join(" → ")}</p>
                  <Button type="button" variant="outline" size="sm" onClick={download}><IconDownload aria-hidden="true" />Download evidence</Button>
                  <p className="text-xs text-muted-foreground">Last verified <time dateTime={evidence.generatedAt}>{new Date(evidence.generatedAt).toLocaleString()}</time></p>
                </CardContent>
              )}
            </Card>
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
