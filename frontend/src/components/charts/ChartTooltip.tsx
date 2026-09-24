import type { TooltipContentProps } from 'recharts'

// One row of chart data as our charts build it: the numeric `count` plus a
// pre-formatted title for the tooltip header.
export interface ChartRow {
  count: number
  tooltipTitle: string
}

interface Props extends Partial<TooltipContentProps<number, string>> {
  unit: string // e.g. "applications"
}

// Value first and large; the name is secondary. (The reader already knows which
// series they're pointing at and wants the number.) All text is rendered by
// React, which escapes it, so data can never inject markup.
export default function ChartTooltip({ active, payload, unit }: Props) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as ChartRow
  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2 shadow-sm text-sm">
      <p className="text-xs text-[var(--viz-ink-2)]">{row.tooltipTitle}</p>
      <p className="mt-1 flex items-center gap-2">
        {/* A short line-key in the series color, not a filled box. */}
        <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: 'var(--viz-series-1)' }} />
        <strong className="font-semibold text-[var(--viz-ink)]">{row.count.toLocaleString()}</strong>
        <span className="text-[var(--viz-ink-2)]">{unit}</span>
      </p>
    </div>
  )
}
