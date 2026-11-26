import { useState } from "react"
import { Card, CardContent, CardHeader } from "./components/ui/card"
import { number, ratio, reasonLabels, runDate, runTime, type Reason, type Run } from "./history"

const RUN_WINDOW = 8
const compact = new Intl.NumberFormat("en-US", { notation: "compact" })

function tickLabel(value: bigint) {
  if (value >= 1_000_000_000_000_000n) return Number(value).toExponential(1)
  return compact.format(value)
}

export function ChecksChart({ runs }: { runs: Run[] }) {
  const recent = runs.slice(0, RUN_WINDOW).reverse().map(run => ({
    run,
    passed: BigInt(run.summary?.passed ?? 0),
    failed: BigInt(run.summary?.failed ?? 0),
  }))
  const [selectedIndex, setSelectedIndex] = useState(recent.length - 1)
  const selected = recent[selectedIndex]
  const largest = recent.reduce((max, { passed, failed }) => passed + failed > max ? passed + failed : max, 4n)
  const scale = ((largest + 3n) / 4n) * 4n

  return (
    <section aria-labelledby="checks-title" className="min-w-0">
      <Card className="h-full gap-0 border-chart bg-chart py-0 text-chart-text shadow-none">
        <CardHeader className="gap-1 px-4 pt-5 pb-4 sm:px-6 sm:pt-6">
          <h2 id="checks-title" className="text-xl font-semibold tracking-tight">Checks by run</h2>
          <p className="text-sm text-chart-muted">
            {recent.length ? `Latest ${recent.length} ${recent.length === 1 ? "run" : "runs"}, oldest to newest` : "Recent checks will appear here once you record a run."}
          </p>
        </CardHeader>
        {selected && (
          <CardContent className="px-4 pb-5 sm:px-6 sm:pb-6">
            <ul aria-label="Chart legend" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-chart-muted" role="list">
              <li className="flex items-center gap-1.5"><span className="size-2.5 bg-chart-pass" aria-hidden="true" />Passed</li>
              <li className="flex items-center gap-1.5"><span className="chart-fail size-2.5" aria-hidden="true" />Failed</li>
              <li className="flex items-center gap-1.5"><span className="mx-0.5 size-2 rotate-45 bg-chart-block" aria-hidden="true" />Blocked run</li>
            </ul>
            <div className="flex h-34 gap-2 sm:h-43 sm:gap-3">
              <div className="flex shrink-0 flex-col justify-between py-0.5 text-right font-mono text-[0.65rem] text-chart-muted" aria-hidden="true">
                {[scale, scale / 2n, 0n].map(tick => <span key={String(tick)}>{tickLabel(tick)}</span>)}
              </div>
              <div className="relative min-w-0 flex-1">
                <div className="absolute inset-0 flex flex-col justify-between py-2.5" aria-hidden="true">
                  <i className="border-t border-chart-rule" />
                  <i className="border-t border-chart-rule" />
                  <i className="border-t border-chart-rule" />
                </div>
                <div className="relative grid h-full gap-px sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${recent.length}, minmax(0, 1fr))` }}>
                  {recent.map(({ run, passed, failed }, index) => (
                    <button
                      key={index} type="button"
                      aria-pressed={index === selectedIndex}
                      aria-label={`Run ${index + 1}, ${runDate(run.finished_at)} at ${runTime(run.finished_at)} UTC: ${run.summary ? `${number.format(passed)} passed, ${number.format(failed)} failed` : "Blocked · no verdict recorded"}`}
                      className="chart-run flex min-w-0 items-end justify-center rounded-sm px-1 py-2.5 sm:px-2"
                      onClick={() => setSelectedIndex(index)}
                    >
                      {run.summary ? (
                        <span className="flex h-full w-full max-w-10 flex-col justify-end" aria-hidden="true">
                          <i className="chart-fail" style={{ height: `${100 * Number(failed) / Number(scale)}%` }} />
                          <i className="bg-chart-pass" style={{ height: `${100 * Number(passed) / Number(scale)}%` }} />
                        </span>
                      ) : (
                        <span className="mb-1 size-2 rotate-45 bg-chart-block" aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mb-3 flex justify-between gap-2 pl-4 font-mono text-[0.65rem] text-chart-muted" aria-hidden="true">
              <span>Oldest</span>
              {recent.length > 1 && <span>Latest</span>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-chart-rule pt-3 text-sm wrap-anywhere" aria-live="polite">
              <time className="font-mono text-xs text-chart-muted" dateTime={selected.run.finished_at}>
                {runDate(selected.run.finished_at)} · {runTime(selected.run.finished_at)} UTC
              </time>
              <span className="font-medium">
                {selected.run.summary ? `${number.format(selected.passed)} passed · ${number.format(selected.failed)} failed` : "Blocked · no verdict recorded"}
              </span>
            </div>
          </CardContent>
        )}
      </Card>
    </section>
  )
}

type ReasonChange = { before: Reason; after: Reason; count: bigint }

export function ChangeChart({ total, transitions }: { total: bigint; transitions: ReasonChange[] }) {
  return (
    <section aria-labelledby="changes-title" className="min-w-0">
      <Card className="h-full gap-5 py-5 shadow-none sm:py-6">
        <CardHeader className="gap-1 px-4 sm:px-6">
          <h2 id="changes-title" className="text-xl font-semibold tracking-tight">Why outcomes changed</h2>
          <p className="text-sm text-muted-foreground">
            {total ? "Flagsmith reasons before and after the edit" : "No flag outcomes changed in these runs."}
          </p>
        </CardHeader>
        {transitions.length > 0 && (
          <CardContent className="px-4 sm:px-6">
            <p className="mb-4 flex flex-wrap items-baseline gap-x-2 border-b pb-3">
              <span className="font-mono text-2xl tracking-tight wrap-anywhere">{number.format(total)}</span>
              <span className="text-sm text-muted-foreground">changed checks</span>
            </p>
            <ul role="list" aria-label="Evaluation reason changes" className="space-y-4">
              {transitions.map(({ before, after, count }) => (
                <li key={`${before}:${after}`}>
                  <div className="mb-1.5 flex justify-between gap-2 text-sm">
                    <span className="min-w-0">{reasonLabels[before]} <span aria-hidden="true">→</span><span className="sr-only">to</span> <strong className="font-semibold">{reasonLabels[after]}</strong></span>
                    <span className="max-w-[55%] shrink-0 text-right font-mono text-xs wrap-anywhere">{number.format(count)}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="h-2 min-w-0 flex-1 bg-muted" aria-hidden="true">
                      <div className="h-full bg-primary" style={{ width: `${100 * Number(count) / Number(total)}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono text-[0.7rem] text-muted-foreground">{ratio(count, total)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </section>
  )
}
