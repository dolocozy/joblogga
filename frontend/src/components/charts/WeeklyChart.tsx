import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Stats } from '../../api'
import { formatDate, formatShortDate } from '../../dates'
import ChartCard from './ChartCard'
import ChartTooltip from './ChartTooltip'

const AXIS_TEXT = { fill: 'var(--viz-ink-2)', fontSize: 12 }

export default function WeeklyChart({ perWeek }: { perWeek: Stats['per_week'] }) {
  const data = perWeek.map((w) => ({
    label: formatShortDate(w.week_start),
    tooltipTitle: `Week of ${formatDate(w.week_start)}`,
    count: w.count,
  }))
  const peak = data.reduce((best, d) => (d.count > best.count ? d : best), data[0])

  return (
    <ChartCard
      title="Applications per week"
      description="Applications sent, by week (weeks start on Monday)"
      table={{ columns: ['Week of', 'Applications'], rows: [...perWeek].reverse().map((w) => [formatDate(w.week_start), w.count]) }}
    >
      {/* The plot is decorative to screen readers; the table view carries the data. */}
      <div role="img" aria-label={`Bar chart of applications per week. Busiest week: ${peak.tooltipTitle.toLowerCase()} with ${peak.count}.`}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeWidth={1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--viz-axis)' }}
              tick={AXIS_TEXT}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TEXT} width={28} />
            <Tooltip content={<ChartTooltip unit="applications" />} cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.5 }} />
            {/* Thin column (max 24px), rounded at the data end, square on the baseline. */}
            <Bar dataKey="count" fill="var(--viz-series-1)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
