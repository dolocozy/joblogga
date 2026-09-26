import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Stats } from '../../api'
import { statusLabel } from '../../status'
import ChartCard from './ChartCard'
import ChartTooltip from './ChartTooltip'

export default function StatusChart({ byStatus }: { byStatus: Stats['by_status'] }) {
  const data = byStatus.map((s) => ({
    label: statusLabel(s.status),
    tooltipTitle: statusLabel(s.status),
    count: s.count,
  }))

  return (
    <ChartCard
      title="Where applications stand"
      description="Applications by current status"
      table={{ columns: ['Status', 'Applications'], rows: data.map((d) => [d.label, d.count]) }}
    >
      {/* Statuses are nominal categories, so every bar shares one color: length
          carries the value, and the row label carries the identity. */}
      <div role="img" aria-label={`Bar chart of applications by status. ${data.map((d) => `${d.label}: ${d.count}`).join(', ')}.`}>
        {/* Tall enough for a row per status, whatever the count. */}
        <ResponsiveContainer width="100%" height={Math.max(232, data.length * 39)}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap="30%">
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--viz-axis)' }}
              tick={{ fill: 'var(--viz-ink-2)', fontSize: 13 }}
              width={118}
            />
            <Tooltip content={<ChartTooltip unit="applications" />} cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.5 }} />
            <Bar dataKey="count" fill="var(--viz-series-1)" maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {/* Value at the tip of each bar; few enough bars that nothing is crowded. */}
              <LabelList dataKey="count" position="right" fill="var(--viz-ink)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
