import { createRoot } from "react-dom/client"
import { Flag } from "lucide-react"
import { ChangeChart, ChecksChart } from "./charts"
import { cn } from "./cn"
import { number, ratio, runDate, runTime, summarize, type Run } from "./history"
import { RunList } from "./run-list"
import "./styles.css"

type Summary = ReturnType<typeof summarize>

function Navigation() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-[85rem] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-7 lg:px-10">
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <div className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary text-primary-foreground">
            <Flag size={16} aria-hidden="true" />
          </div>
          <span>Flagsmith Rehearsal</span>
        </div>
        <nav aria-label="Dashboard sections" className="flex gap-4 sm:gap-6">
          <a className="inline-flex min-h-11 items-center text-sm font-medium hover:text-primary hover:underline" href="#overview">Overview</a>
          <a className="inline-flex min-h-11 items-center text-sm font-medium hover:text-primary hover:underline" href="#run-history-title">Run history</a>
        </nav>
      </div>
    </header>
  )
}

function Metrics({ count, summary }: { count: number; summary: Summary }) {
  const checked = summary.passed + summary.failed
  const metrics = [
    { label: "Runs recorded", value: number.format(count), detail: `${number.format(summary.verdictCounts.passed)} passed` },
    { label: "Expectations passed", value: ratio(summary.passed, checked), detail: checked ? `${number.format(summary.passed)} of ${number.format(checked)} checks` : "No completed checks" },
    { label: "Failed runs", value: number.format(summary.verdictCounts.failed), detail: `${number.format(summary.failed)} unmet expectations`, emphasis: summary.verdictCounts.failed > 0 },
    { label: "Blocked runs", value: number.format(summary.verdictCounts.blocked), detail: "Stopped before a verdict" },
  ]

  return (
    <dl className="grid grid-cols-2 gap-px border-y bg-border md:grid-cols-4" aria-label="Rehearsal metrics">
      {metrics.map(({ label, value, detail, emphasis }) => (
        <div key={label} className="min-w-0 bg-background px-3 py-3.5 sm:px-5 sm:py-5">
          <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
          <dd className={cn("mt-1 text-3xl leading-tight font-semibold tracking-tight tabular-nums wrap-anywhere sm:text-4xl", emphasis && "text-primary")}>{value}</dd>
          <dd className="mt-1 text-xs text-muted-foreground wrap-anywhere sm:text-sm">{detail}</dd>
        </div>
      ))}
    </dl>
  )
}

function Dashboard({ runs }: { runs: Run[] }) {
  const summary = summarize(runs)
  const latest = runs[0]
  return (
    <>
      <a className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10 focus:rounded-md focus:bg-card focus:p-3" href="#overview">Skip to content</a>
      <Navigation />
      <main className="mx-auto w-full max-w-[85rem] space-y-5 px-4 pt-6 pb-10 sm:space-y-6 sm:px-7 sm:pt-9 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h1 id="overview" tabIndex={-1} className="text-[2.45rem] leading-[1.03] font-semibold tracking-[-0.05em] sm:text-[3.4rem]">Rollout history</h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">See how proposed flag changes affected your test personas before release.</p>
          </div>
          {latest && (
            <div className="border-l-2 border-primary pl-2.5 text-xs">
              <div className="text-muted-foreground">Latest run (UTC)</div>
              <time dateTime={latest.finished_at} className="mt-0.5 block font-mono">{runDate(latest.finished_at)} · {runTime(latest.finished_at)}</time>
            </div>
          )}
        </header>
        <Metrics count={runs.length} summary={summary} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <ChecksChart runs={runs} />
          <ChangeChart total={summary.changed} transitions={summary.transitions} />
        </div>
        <RunList runs={runs} />
      </main>
    </>
  )
}

const container = document.getElementById("dashboard-root")
const data = document.getElementById("rehearsal-data")
if (container && data?.textContent) {
  createRoot(container).render(<Dashboard runs={JSON.parse(data.textContent)} />)
}
