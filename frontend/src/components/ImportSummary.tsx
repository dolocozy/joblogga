import { Link } from 'react-router-dom'
import type { ImportResult, ImportRowNote } from '../api'
import { groupNotes, plural, rowsLabel } from '../importSummary'

function NoteList({ notes }: { notes: ImportRowNote[] }) {
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
      {groupNotes(notes).map((g) => (
        <li key={g.reason}>
          {g.reason} <span className="text-ink-soft">({rowsLabel(g.rows)})</span>
        </li>
      ))}
    </ul>
  )
}

// What an import did, in words: nothing happens silently. What was skipped is open; the rest can be unfolded.
export default function ImportSummary({ result }: { result: ImportResult }) {
  const { added, skipped, duplicates, adjusted, blank_rows: blank } = result
  return (
    <div className="sheet space-y-3 border-l-2 border-l-pine p-4" role="region" aria-label="Import result">
      <p role="status" className="font-semibold">
        {added > 0 ? `Imported ${plural(added, 'application')}.` : 'Nothing was imported.'}
      </p>
      <ul className="space-y-0.5 text-sm">
        {skipped.length > 0 && <li>{plural(skipped.length, 'row')} skipped because they could not be imported.</li>}
        {duplicates.length > 0 && <li>{plural(duplicates.length, 'row')} left out as duplicates of applications you already have.</li>}
        {adjusted.length > 0 && <li>{plural(adjusted.length, 'note')} about values that were left empty or filled in.</li>}
        {blank > 0 && <li className="text-ink-soft">{plural(blank, 'blank row')} ignored.</li>}
      </ul>

      {skipped.length > 0 && (
        <section aria-label="Skipped rows">
          <h3 className="text-base">Skipped</h3>
          <NoteList notes={skipped} />
        </section>
      )}
      {duplicates.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Left out as duplicates</summary>
          <NoteList notes={duplicates} />
        </details>
      )}
      {adjusted.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Adjusted values</summary>
          <NoteList notes={adjusted} />
        </details>
      )}
      {added > 0 && (
        <Link to="/applications" className="link text-sm">
          View your applications
        </Link>
      )}
    </div>
  )
}
