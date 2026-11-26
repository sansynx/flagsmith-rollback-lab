export type Verdict = "passed" | "failed" | "blocked"
export type Reason = "DEFAULT" | "STATIC" | "TARGETING_MATCH" | "SPLIT" | "OTHER"

export type Run = {
  status: Verdict
  finished_at: string
  duration_ms: string
  evaluation: "both" | "bulk" | "single"
  baseline_sha256?: string
  summary?: { passed: string; failed: string; changed: string }
  transitions?: { before: Reason; after: Reason; count: string }[]
}

export const reasonLabels: Record<Reason, string> = {
  DEFAULT: "Default",
  STATIC: "Static",
  TARGETING_MATCH: "Targeting match",
  SPLIT: "Percentage split",
  OTHER: "Other",
}

export const verdictLabels: Record<Verdict, string> = {
  passed: "Passed",
  failed: "Failed",
  blocked: "Blocked",
}

export const evaluationLabels = {
  both: "Bulk and single flag",
  bulk: "Bulk",
  single: "Single flag",
}

export const verdicts: Verdict[] = ["passed", "failed", "blocked"]
export const number = new Intl.NumberFormat("en-US")
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 })
const day = new Intl.DateTimeFormat("en", {
  timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
})
const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
})

export function runDate(timestamp: string) {
  return day.format(new Date(timestamp))
}

export function runTime(timestamp: string) {
  return time.format(new Date(timestamp))
}

export function ratio(part: bigint, total: bigint) {
  return total ? percent.format(Number((part * 1000n + total / 2n) / total) / 1000) : "—"
}

export function summarize(runs: Run[]) {
  const verdictCounts = { passed: 0, failed: 0, blocked: 0 }
  let passed = 0n
  let failed = 0n
  let changed = 0n
  const reasons = new Map<string, { before: Reason; after: Reason; count: bigint }>()

  for (const run of runs) {
    verdictCounts[run.status] += 1
    if (run.summary) {
      passed += BigInt(run.summary.passed)
      failed += BigInt(run.summary.failed)
      changed += BigInt(run.summary.changed)
    }
    for (const transition of run.transitions ?? []) {
      const key = `${transition.before}:${transition.after}`
      const saved = reasons.get(key)
      const count = (saved?.count ?? 0n) + BigInt(transition.count)
      reasons.set(key, { before: transition.before, after: transition.after, count })
    }
  }

  const transitions = Array.from(reasons.values()).sort((left, right) => {
    if (left.count === right.count) {
      return `${left.before}:${left.after}`.localeCompare(`${right.before}:${right.after}`, "en")
    }
    return left.count > right.count ? -1 : 1
  })
  return { verdictCounts, passed, failed, changed, transitions }
}
