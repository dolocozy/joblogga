import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Stats } from '../../api'
import ChartCard from './ChartCard'
import ChartTooltip from './ChartTooltip'

export const NOT_SPECIFIED = 'Not specified'
const shorten = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)
const percent = (rate: number) => Math.round(rate * 100)

// Response rate for each resume version, so "tech-focused 40%, events-focused 15%" is visible. A rate is shown only for a
// version with enough applications behind it (one lucky reply is not a 100% resume); every version is in the table, with its
// raw counts, so nothing is hidden and the groups add up to your applications (versions you never set are "Not specified").
export default function ResumeChart({ resume }: { resume: Stats['resume'] }) {
  const { versions, min_sample: minSample } = resume
  const label = (v: Stats['resume']['versions'][number]) => v.name ?? NOT_SPECIFIED
  const charted = versions.filter((v) => v.enough_data && v.rate !== null)
  const onlyUnspecified = versions.length > 0 && versions.every((v) => v.name === null)

  const data = charted.map((v) => ({
    label: label(v),
    tooltipTitle: `${label(v)}: ${v.responded} of ${v.eligible} heard back`,
    count: percent(v.rate!),
  }))

  return (
    <ChartCard
      title="Response rate by resume version"
      description="Share of applications that got a reply, by the resume sent"
      table={{
        columns: ['Resume version', 'Applications', 'Heard back', 'Response rate'],
        rows: versions.map((v) => [
          label(v),
          v.applications,
          `${v.responded} of ${v.eligible}`,
          v.eligible === 0 ? '—' : v.enough_data ? `${percent(v.rate!)}%` : 'too few to judge',
        ]),
      }}
    >
      {versions.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">Nothing to show yet.</p>
      ) : onlyUnspecified ? (
        <p className="py-6 text-sm text-ink-soft">
          None of your applications says which resume it used. Fill in &ldquo;Resume version&rdquo; on an application and the versions can be compared here.
        </p>
      ) : data.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">
          No version has {minSample} applications that count yet, so no rates are shown: with fewer, a percentage says more than the data can. The counts are in the table.
        </p>
      ) : (
        <div role="img" aria-label={`Bar chart of response rate by resume version. ${data.map((d) => `${d.label}: ${d.count}%`).join(', ')}.`}>
          <ResponsiveContainer width="100%" height={Math.max(120, data.length * 40 + 24)}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide domain={[0, 100]} />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-axis)' }}
                tick={{ fill: 'var(--viz-ink-2)', fontSize: 13 }}
                tickFormatter={shorten}
                width={132}
              />
              <Tooltip content={<ChartTooltip unit="% heard back" />} cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.5 }} />
              <Bar dataKey="count" fill="var(--viz-series-1)" maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList dataKey="count" position="right" fill="var(--viz-ink)" fontSize={12} formatter={(v: unknown) => `${v}%`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}
