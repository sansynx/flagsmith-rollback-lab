import { IconCircleCheck, IconCircleX, IconFlag, IconGitMerge } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import type { Evidence } from "@/evidence"

export function SectionCards({ evidence }: { evidence: Evidence }) {
  const failed = evidence.original.steps.at(-1)
  const paid = evidence.revised.steps.at(-2)
  const originalRetirement = evidence.original.steps.at(-2)
  const revisedRetirement = evidence.revised.steps.at(-1)
  const cards = [
    { label: "Original rollback", value: `HTTP ${failed?.httpStatus}`, tag: "Failed", icon: IconCircleX, detail: "Open session failed", sub: `${originalRetirement?.pendingTreatment} treatment session pending at retirement`, destructive: true },
    { label: "Revised rollback", value: `HTTP ${paid?.httpStatus}`, tag: "Verified", icon: IconCircleCheck, detail: "Open session completed", sub: `${revisedRetirement?.pendingTreatment} treatment sessions pending at retirement` },
    { label: "Fresh visitor", value: "Control", tag: "Both runs", icon: IconFlag, detail: "New visitors get control", sub: "Read from the live Flagsmith flag" },
    { label: "Final state", value: "Identical", tag: "Both runs", icon: IconGitMerge, detail: "Treatment off, handler retired", sub: "The order changed the outcome" },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {cards.map(({ label, value, tag, icon: Icon, detail, sub, destructive }) => (
        <Card className="@container/card" key={label}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
            <CardAction><Badge variant={destructive ? "destructive" : "outline"}><Icon aria-hidden="true" />{tag}</Badge></CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="font-medium">{detail}</div>
            <div className="text-muted-foreground">{sub}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
