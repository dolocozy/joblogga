import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { fetchOffers } from '../api'
import type { Offer } from '../api'
import PostingLink from '../components/PostingLink'
import StatusBadge from '../components/StatusBadge'
import TagList from '../components/TagList'
import { formatDate } from '../dates'
import { safePostingUrl } from '../links'
import { roundsLabel } from '../rounds'
import { salaryLine } from '../salary'
import { MAX_TAGS } from '../tags'
import { placeLine, workModeLabel } from '../workMode'

// A column per offer stops being readable past a handful; this is the most compared at once.
export const MAX_COMPARED = 4

const Missing = () => <span className="text-ink-soft">Not recorded</span>

function Row({ label, offers, cell }: { label: string; offers: Offer[]; cell: (o: Offer) => ReactNode }) {
  return (
    <tr className="border-b border-rule align-top">
      <th scope="row" className="sticky left-0 w-32 min-w-32 bg-paper py-3 pr-4 text-left text-sm font-semibold text-ink-soft">
        {label}
      </th>
      {offers.map((o) => (
        <td key={o.id} className="min-w-52 py-3 pr-4 text-sm">
          {cell(o)}
        </td>
      ))}
    </tr>
  )
}

export default function Offers() {
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  // null means "the default": the newest few. Once the person picks, this is exactly what they picked.
  const [chosen, setChosen] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchOffers(includeArchived)
      .then((list) => {
        if (cancelled) return
        setOffers(list)
        setError(null)
        setChosen(null)
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load your offers'))
    return () => {
      cancelled = true
    }
  }, [includeArchived])

  const compared = offers === null ? [] : chosen === null ? offers.slice(0, MAX_COMPARED) : offers.filter((o) => chosen.includes(o.id))
  const currencies = [...new Set(compared.filter((o) => o.salary_min !== null || o.salary_max !== null).map((o) => o.salary_currency))].sort()

  function toggle(id: number) {
    const current = compared.map((o) => o.id)
    setChosen(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
  }

  return (
    <>
      <Link to="/dashboard" className="link text-sm">
        Back to dashboard
      </Link>
      <div className="mb-6 mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-3xl">Compare offers</h1>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived offers
        </label>
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
          {error}
        </p>
      )}
      {offers === null && !error && <p className="text-ink-soft">Loading…</p>}

      {offers !== null && offers.length < 2 && (
        <div className="sheet p-8 text-ink-soft">
          <p>
            {offers.length === 0 ? 'You have no offers yet.' : 'You have one offer.'} Offers can be compared once two or more applications are at Offer, Offer
            accepted or Offer declined.
          </p>
          <p className="mt-2">
            <Link to="/applications" className="link">
              Back to your applications
            </Link>
          </p>
        </div>
      )}

      {offers !== null && offers.length >= 2 && (
        <>
          {offers.length > MAX_COMPARED && (
            <fieldset className="mb-6">
              <legend className="mb-1 text-sm font-semibold">
                You have {offers.length} offers. Choose up to {MAX_COMPARED} to compare.
              </legend>
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {offers.map((o) => {
                  const checked = compared.some((c) => c.id === o.id)
                  return (
                    <li key={o.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={checked} disabled={!checked && compared.length >= MAX_COMPARED} onChange={() => toggle(o.id)} />
                        {o.company}, {o.role}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )}

          {currencies.length > 1 && (
            <p role="note" className="mb-4 border-l-2 border-marker bg-marker/20 px-3 py-2 text-sm">
              These offers are in different currencies ({currencies.join(', ')}). Amounts are shown as entered and are not converted, so they cannot be compared
              directly.
            </p>
          )}

          {compared.length === 0 ? (
            <p className="text-ink-soft">Choose at least one offer above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">Offers side by side</caption>
                <thead>
                  <tr className="border-b-2 border-ink align-bottom">
                    <td className="sticky left-0 bg-paper" />
                    {compared.map((o) => (
                      <th key={o.id} scope="col" className="min-w-52 py-2 pr-4 text-left font-normal">
                        <Link to={`/applications/${o.id}`} className="block text-lg font-semibold hover:underline">
                          {o.company}
                        </Link>
                        <span className="text-sm text-ink-soft">{o.role}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Status" offers={compared} cell={(o) => <StatusBadge status={o.status} />} />
                  <Row label="Salary" offers={compared} cell={(o) => (salaryLine(o) ? <span className="figure">{salaryLine(o)}</span> : <Missing />)} />
                  <Row label="Work mode" offers={compared} cell={(o) => (o.work_mode ? workModeLabel[o.work_mode] : <Missing />)} />
                  <Row label="Location" offers={compared} cell={(o) => placeLine(o) ?? <Missing />} />
                  <Row label="Interview rounds" offers={compared} cell={(o) => roundsLabel(o) ?? <Missing />} />
                  <Row label="Applied" offers={compared} cell={(o) => (o.date_applied ? <span className="figure">{formatDate(o.date_applied)}</span> : <Missing />)} />
                  <Row
                    label="Offer recorded"
                    offers={compared}
                    cell={(o) =>
                      o.offer_recorded_on ? (
                        <>
                          <span className="figure">{formatDate(o.offer_recorded_on)}</span>
                          {o.days_to_offer !== null && (
                            <span className="block text-ink-soft">
                              {o.days_to_offer === 0 ? 'the day you applied' : `${o.days_to_offer} ${o.days_to_offer === 1 ? 'day' : 'days'} after applying`}
                            </span>
                          )}
                        </>
                      ) : (
                        <Missing />
                      )
                    }
                  />
                  <Row label="Tags" offers={compared} cell={(o) => (o.tags.length ? <TagList tags={o.tags} max={MAX_TAGS} /> : <Missing />)} />
                  <Row label="Posting" offers={compared} cell={(o) => (safePostingUrl(o.job_url) ? <PostingLink url={o.job_url} company={o.company} /> : <Missing />)} />
                  <Row
                    label="Notes"
                    offers={compared}
                    cell={(o) => (o.notes ? <p className="max-h-48 overflow-y-auto whitespace-pre-wrap">{o.notes}</p> : <Missing />)}
                  />
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-6 max-w-3xl text-sm text-ink-soft">
            Read from what you have recorded; nothing here is estimated or converted. &ldquo;Offer recorded&rdquo; is the day the application was first moved to an offer
            status in Joblogga, so it is only as accurate as your updates. Offers are listed newest first.
          </p>
        </>
      )}
    </>
  )
}
