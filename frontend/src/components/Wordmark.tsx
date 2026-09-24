import { Link } from 'react-router-dom'

export default function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="font-serif text-2xl font-semibold tracking-tight text-ink">
      Joblogga
    </Link>
  )
}
