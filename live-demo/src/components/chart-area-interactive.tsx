import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import type { Evidence } from "@/evidence"

const chartConfig = {
  original: { label: "Original rollback", color: "var(--chart-2)" },
  revised: { label: "Revised rollback", color: "var(--chart-4)" },
} satisfies ChartConfig

export function ChartAreaInteractive({ evidence }: { evidence: Evidence }) {
  const data = evidence.original.steps.map((step, index) => ({
    step: `Step ${index + 1}`,
    original: step.pendingTreatment,
    revised: evidence.revised.steps[index].pendingTreatment,
  }))

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Open treatment sessions</CardTitle>
        <CardDescription>The revised plan waits for the open session to complete before retiring its handler.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
          <AreaChart accessibilityLayer data={data} margin={{ left: -12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="step" tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis width={34} domain={[0, 1]} ticks={[0, 1]} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Area dataKey="original" type="stepAfter" fill="var(--color-original)" fillOpacity={0.14} stroke="var(--color-original)" strokeWidth={2} isAnimationActive={false} />
            <Area dataKey="revised" type="stepAfter" fill="var(--color-revised)" fillOpacity={0.2} stroke="var(--color-revised)" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
