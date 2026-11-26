import { useState } from "react"
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react"
import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { Card, CardContent, CardHeader } from "./components/ui/card"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "./components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table"
import { cn } from "./cn"
import {
  evaluationLabels, number, reasonLabels, runDate, runTime, verdictLabels, verdicts,
  type Run, type Verdict,
} from "./history"

const PAGE_SIZE = 10

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <Badge variant="outline" className={cn("rounded-md border-transparent px-2 py-1 text-xs", `tone-${verdict}`)}>
      <span className={cn("size-1.5 rounded-full", `fill-${verdict}`)} aria-hidden="true" />
      {verdictLabels[verdict]}
    </Badge>
  )
}

function RunDetails({ run }: { run: Run }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-h-10" aria-label={`Details for ${runDate(run.finished_at)} at ${runTime(run.finished_at)} UTC, ${verdictLabels[run.status]}`}>
          Details <ChevronRight aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card">
        <DialogHeader>
          <DialogTitle>Run details</DialogTitle>
          <DialogDescription>{runDate(run.finished_at)} at {runTime(run.finished_at)} UTC</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <div><dt className="mb-1 text-muted-foreground">Verdict</dt><dd><VerdictBadge verdict={run.status} /></dd></div>
          <div><dt className="mb-1 text-muted-foreground">Duration</dt><dd>{number.format(BigInt(run.duration_ms))} ms</dd></div>
          <div className="col-span-2"><dt className="mb-1 text-muted-foreground">Flagsmith SDK mode</dt><dd>{evaluationLabels[run.evaluation]}</dd></div>
          {run.baseline_sha256 && (
            <div className="col-span-2 min-w-0">
              <dt className="mb-1 text-muted-foreground">Baseline SHA-256</dt>
              <dd><code className="block rounded-md bg-muted p-3 text-xs wrap-anywhere">{run.baseline_sha256}</code></dd>
            </div>
          )}
        </dl>
        {run.summary ? (
          <div className="space-y-3 border-t pt-4 text-sm">
            <p>{number.format(BigInt(run.summary.passed))} passed · {number.format(BigInt(run.summary.failed))} failed · {number.format(BigInt(run.summary.changed))} changed</p>
            {run.transitions && run.transitions.length > 0 && (
              <ul className="space-y-2" aria-label="Reason changes in this run">
                {run.transitions.map(({ before, after, count }) => (
                  <li className="flex items-start justify-between gap-3" key={`${before}:${after}`}>
                    <span>{reasonLabels[before]} → {reasonLabels[after]}</span>
                    <span className="shrink-0 tabular-nums">{number.format(BigInt(count))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            This run produced no verdict. The rehearsal log has the reason it stopped.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RunDate({ run }: { run: Run }) {
  return (
    <time dateTime={run.finished_at} className="block text-sm">
      <span className="font-medium">{runDate(run.finished_at)}</span>
      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{runTime(run.finished_at)}<span className="md:hidden"> UTC</span></span>
    </time>
  )
}

function Checks({ run }: { run: Run }) {
  if (!run.summary) return <><span className="sr-only">No verdict</span><span aria-hidden="true">—</span></>
  return (
    <span className="tabular-nums wrap-anywhere">
      {number.format(BigInt(run.summary.passed))} / {number.format(BigInt(run.summary.passed) + BigInt(run.summary.failed))} passed
    </span>
  )
}

export function RunList({ runs }: { runs: Run[] }) {
  const [filter, setFilter] = useState<Verdict | "all">("all")
  const [page, setPage] = useState(0)
  const matches = runs.filter(run => filter === "all" || run.status === filter)
  const shown = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const first = page * PAGE_SIZE + 1
  const last = Math.min((page + 1) * PAGE_SIZE, matches.length)

  return (
    <section id="run-history" aria-labelledby="run-history-title" className="scroll-mt-5">
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <CardHeader className="gap-3 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 id="run-history-title" tabIndex={-1} className="text-xl font-semibold tracking-tight">Run history</h2>
          </div>
          <div role="group" aria-label="Filter by verdict" className="flex w-fit max-w-full flex-wrap gap-1 rounded-md border bg-muted p-1">
            {(["all", ...verdicts] as const).map(value => (
              <Button
                type="button" size="sm" variant="ghost" key={value}
                aria-pressed={filter === value}
                className={cn("min-h-10 min-w-12 px-2 text-xs sm:min-h-9 sm:px-3", filter === value && "bg-card text-primary hover:bg-card")}
                onClick={() => { setFilter(value); setPage(0) }}
              >
                {value === "all" ? "All runs" : verdictLabels[value]}
              </Button>
            ))}
          </div>
        </CardHeader>
        {shown.length ? (
          <>
            <div className="hidden border-y md:block">
              <Table aria-label="Rehearsal runs" className="table-fixed">
                <TableHeader className="bg-muted/70">
                  <TableRow>
                    <TableHead scope="col" className="w-[21%] pl-6 text-xs text-muted-foreground">Finished (UTC)</TableHead>
                    <TableHead scope="col" className="w-[14%] text-xs text-muted-foreground">Verdict</TableHead>
                    <TableHead scope="col" className="w-[22%] text-xs text-muted-foreground">Expectations</TableHead>
                    <TableHead scope="col" className="w-[13%] text-xs text-muted-foreground">Changed</TableHead>
                    <TableHead scope="col" className="w-[14%] text-xs text-muted-foreground">Duration</TableHead>
                    <TableHead scope="col" className="w-[16%] pr-6"><span className="sr-only">Run details</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((run, index) => (
                    <TableRow key={first + index} className="group">
                      <TableCell className="py-3 pl-6"><RunDate run={run} /></TableCell>
                      <TableCell><VerdictBadge verdict={run.status} /></TableCell>
                      <TableCell className="whitespace-normal"><Checks run={run} /></TableCell>
                      <TableCell className="tabular-nums wrap-anywhere whitespace-normal">{run.summary ? number.format(BigInt(run.summary.changed)) : "—"}</TableCell>
                      <TableCell className="tabular-nums wrap-anywhere whitespace-normal">{number.format(BigInt(run.duration_ms))} ms</TableCell>
                      <TableCell className="pr-6 text-right"><RunDetails run={run} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul aria-label="Rehearsal runs" role="list" className="divide-y border-y md:hidden">
              {shown.map((run, index) => (
                <li key={first + index} className="space-y-3 px-4 py-3.5 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <RunDate run={run} />
                    <VerdictBadge verdict={run.status} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0 space-y-1 text-xs text-muted-foreground wrap-anywhere">
                      <div><Checks run={run} /></div>
                      <div>{run.summary ? `${number.format(BigInt(run.summary.changed))} changed · ` : ""}{number.format(BigInt(run.duration_ms))} ms</div>
                    </div>
                    <RunDetails run={run} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <CardContent className="flex flex-col items-center gap-2 border-y px-4 py-9 text-center">
            <Inbox className="text-muted-foreground" size={22} aria-hidden="true" />
            <p className="font-medium">{filter === "all" ? "No rehearsals recorded" : `No ${filter} runs`}</p>
            {filter === "all" && <p className="text-sm text-muted-foreground">Run a rehearsal with <code>--save-receipts</code>, then regenerate this report.</p>}
          </CardContent>
        )}
        <div className="flex min-h-14 items-center justify-between gap-2 px-4 py-2 text-xs text-muted-foreground sm:px-6">
          <span role="status">
            {matches.length ? `${number.format(first)}–${number.format(last)} of ${number.format(matches.length)} ${matches.length === 1 ? "run" : "runs"}` : "0 runs"}
          </span>
          {matches.length > PAGE_SIZE && (
            <div className="flex gap-1.5">
              <Button type="button" size="icon-sm" variant="outline" aria-label="Previous page" aria-disabled={!page}
                className="aria-disabled:cursor-default aria-disabled:opacity-50" onClick={() => { if (page > 0) setPage(page - 1) }}>
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" aria-label="Next page" aria-disabled={last >= matches.length}
                className="aria-disabled:cursor-default aria-disabled:opacity-50" onClick={() => { if (last < matches.length) setPage(page + 1) }}>
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </Card>
    </section>
  )
}
