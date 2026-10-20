import { Link } from 'react-router-dom'

// A short line stub before the name: the first piece of the route motif that the nav and the application rows build on.
export default function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-serif text-xl font-medium text-ink">
      <span aria-hidden className="inline-block h-1 w-4 bg-cobalt" />
      Joblogga
    </Link>
  )
}
