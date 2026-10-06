// The footer shared by the landing page and the FAQ: the licence, the data credit and the Claude Code note.
export default function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-soft md:px-8">
        <p>
          Joblogga is open source under the MIT license.{' '}
          <a href="https://github.com/dolocozy/joblogga" className="link" target="_blank" rel="noopener noreferrer">
            View the source on GitHub
          </a>
          .
        </p>
        <p>
          Place data from the{' '}
          <a href="https://github.com/dr5hn/countries-states-cities-database" className="link" target="_blank" rel="noopener noreferrer">
            countries-states-cities database
          </a>{' '}
          (ODbL).
        </p>
        <p>Built with Claude Code as a development tool.</p>
      </div>
    </footer>
  )
}
