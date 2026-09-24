import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import LoginForm from '../components/LoginForm'
import StatusBadge from '../components/StatusBadge'
import Wordmark from '../components/Wordmark'
import { DateCell, FollowUp, LEDGER_COLUMNS, LedgerHeader } from '../components/Ledger'
import { warmUpServer } from '../api'
import type { ApplicationStatus } from '../api'

// Made-up companies, for showing what a page of the logbook looks like.
const SAMPLE: { company: string; role: string; status: ApplicationStatus; applied: string; followUp?: string; overdue?: boolean }[] = [
  { company: 'Harbor Analytics', role: 'Data Analyst, Remote', status: 'interview', applied: 'Feb 24, 2026' },
  { company: 'Fernhill Health', role: 'Operations Analyst', status: 'screening', applied: 'Mar 2, 2026', followUp: 'Mar 9, 2026', overdue: true },
  { company: 'Northwind Studio', role: 'Program Coordinator, Portland', status: 'applied', applied: 'Mar 5, 2026', followUp: 'Mar 19, 2026' },
  { company: 'Pinecone Logistics', role: 'Planning Analyst', status: 'offer', applied: 'Feb 12, 2026' },
  { company: 'Lakeside Museum', role: 'Events Manager', status: 'rejected', applied: 'Jan 30, 2026' },
]

const FEATURES: [string, string][] = [
  ['Log each application.', 'Company, role, the posting link, salary range, location, notes, and which resume version you sent.'],
  ['Follow a clear pipeline.', 'Applied, Screening, Interview, Offer, Rejected or Withdrawn, with every change dated and kept.'],
  ['Never lose a follow-up.', 'Set a follow-up date and the ones that are due or overdue rise to the top of your list.'],
  ['Find anything.', 'Search by keyword, or filter by status, company and date.'],
  ['See how it is going.', 'A dashboard shows your response rate and how many applications you send each week.'],
]

const STAGES: [string, string][] = [
  ['Applied', 'Sent'],
  ['Screening', 'First conversation'],
  ['Interview', 'In the process'],
  ['Offer', 'Yours to accept or decline'],
]

// Each section keeps its heading in a left margin, like notes beside a ledger.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-rule py-10 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
      <h2 className="text-2xl">{title}</h2>
      <div className="max-w-2xl space-y-4">{children}</div>
    </section>
  )
}

export default function Landing() {
  useEffect(warmUpServer, [])

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <Wordmark />
        <Link to="/signup" className="btn btn-secondary btn-sm">
          Create an account
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 md:px-8">
        <div className="grid gap-10 pb-14 pt-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-16 lg:pt-14">
          <div>
            <h1 className="text-5xl leading-[1.05] sm:text-6xl">A logbook for your job search</h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Joblogga keeps every application in one place: where it stands, when you applied, which resume you sent,
              and when to follow up. It replaces the spreadsheet and the twenty open tabs.
            </p>
          </div>
          <div className="sheet self-start p-6">
            <LoginForm />
          </div>
        </div>

        <section aria-labelledby="sample-title" className="pb-12">
          <h2 id="sample-title" className="mb-4 text-2xl">
            What a page looks like
          </h2>
          <div className="sheet px-4 pb-2 pt-4 md:px-6">
            <LedgerHeader />
            <ul>
              {SAMPLE.map((row) => (
                <li
                  key={row.company}
                  className={`grid gap-x-4 gap-y-1 border-b border-rule py-3 last:border-0 md:items-center ${LEDGER_COLUMNS}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{row.company}</p>
                    <p className="truncate text-sm text-ink-soft">{row.role}</p>
                  </div>
                  <StatusBadge status={row.status} />
                  <DateCell label="Applied">{row.applied}</DateCell>
                  <DateCell label="Follow up">
                    {row.followUp ? <FollowUp text={row.followUp} overdue={!!row.overdue} /> : <span className="text-ink-soft">None</span>}
                  </DateCell>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-sm text-ink-soft">A sample page with made-up companies. Yours fills in as you go.</p>
        </section>

        <Section title="What it does">
          <ul className="space-y-3">
            {FEATURES.map(([lead, rest]) => (
              <li key={lead}>
                <span className="font-semibold">{lead}</span> {rest}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Who it is for">
          <p>
            People in the middle of a real search, sending applications faster than they can remember them. If a
            spreadsheet, a notes file and a dozen open tabs are all trying to answer &ldquo;did I already apply
            there?&rdquo;, this is for you.
          </p>
          <p>
            I built Joblogga during my own job search, because a spreadsheet stopped being enough. It is the tool I
            wanted while I was applying.
          </p>
        </Section>

        <Section title="How it works">
          <ol className="grid grid-cols-2 gap-x-4 gap-y-5 border-t-2 border-ink pt-3 sm:grid-cols-4">
            {STAGES.map(([name, meaning]) => (
              <li key={name}>
                <p className="font-semibold">{name}</p>
                <p className="text-sm text-ink-soft">{meaning}</p>
              </li>
            ))}
          </ol>
          <p>An application can also end as Rejected or Withdrawn.</p>
          <p>
            Change a status from the list in one click. Each change is recorded with its date, so you can see how long
            an application sat at each stage.
          </p>
        </Section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-soft md:px-8">
          <p>
            Joblogga is open source under the MIT license.{' '}
            <a href="https://github.com/dolocozy/joblogga" className="link" target="_blank" rel="noopener noreferrer">
              View the source on GitHub
            </a>
            .
          </p>
          <p>Built with Claude Code as a development tool.</p>
        </div>
      </footer>
    </div>
  )
}
