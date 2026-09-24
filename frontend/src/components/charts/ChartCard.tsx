import { useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  title: string
  description: string // names the series and unit, so the chart needs no legend
  table: { columns: string[]; rows: (string | number)[][] }
  children: ReactNode // the chart
}

// A titled card with a chart and its table twin. Every value the chart shows
// can be read from the table without hovering, so the tooltip never gates data.
export default function ChartCard({ title, description, table, children }: Props) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="sheet p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg">{title}</h2>
          <p className="text-sm text-ink-soft">{description}</p>
        </div>
        <button
          type="button"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
          className="btn btn-secondary btn-sm shrink-0"
        >
          {showTable ? 'View chart' : 'View as table'}
        </button>
      </div>

      <div className="mt-4">
        {showTable ? (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-b-2 border-ink text-left text-ink-soft">
                  {table.columns.map((c, i) => (
                    <th key={c} scope="col" className={`py-1.5 font-medium ${i > 0 ? 'text-right' : ''}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={String(row[0])} className="border-b border-rule last:border-0">
                    {row.map((cell, i) => (
                      // Mono figures only here, where numbers align in a column.
                      <td key={i} className={`py-1.5 ${i > 0 ? 'figure text-right' : ''}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
