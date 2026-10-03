import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Stats } from '../../api'
import { formatDays, stillHere } from '../../stageTimes'
import { statusLabel } from '../../status'
import ChartCard from './ChartCard'
import ChartTooltip from './ChartTooltip'

// Average days in each pipeline stage, from the status history. Only stays that have ended are in the average;
// applications still waiting in a stage are in the table's last column instead (see backend/app/stage_times.py).
export default function StageTimeChart({ stages }: { stages: Stats['stages'] }) {
  // A stage nothing has moved on from yet has no bar (an empty bar would read as "zero days").
  const data = stages
    .filter((s) => s.mean_days !== null)
    .map((s) => ({
      label: statusLabel(s.status),
      tooltipTitle: `${statusLabel(s.status)}, ${s.finished} ${s.finished === 1 ? 'stay' : 'stays'} finished`,
      count: Math.round(s.mean_days! * 10) / 10,
    }))

  return (
    <ChartCard
      title="Time in each stage"
      description="Average days before an application moved on"
      table={{
        columns: ['Stage', 'Moved on', 'Average', 'Median', 'Still here'],
        rows: stages.map((s) => [statusLabel(s.status), s.finished, formatDays(s.mean_days), formatDays(s.median_days), stillHere(s)]),
      }}
    >
      {data.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">Nothing to measure yet. A stage appears here once an application has moved on from it.</p>
      ) : (
        <div role="img" aria-label={`Bar chart of average days in each stage. ${data.map((d) => `${d.label}: ${formatDays(d.count)}`).join(', ')}.`}>
          <ResponsiveContainer width="100%" height={Math.max(120, data.length * 40 + 24)}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-axis)' }}
                tick={{ fill: 'var(--viz-ink-2)', fontSize: 13 }}
                width={92}
              />
              <Tooltip content={<ChartTooltip unit="days on average" />} cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.5 }} />
              <Bar dataKey="count" fill="var(--viz-series-1)" maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList dataKey="count" position="right" fill="var(--viz-ink)" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}
