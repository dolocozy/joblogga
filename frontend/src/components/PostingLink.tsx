import { safePostingUrl } from '../links'

interface Props {
  url: string | null
  // Names the application for screen readers, since a page can hold many "View posting" links.
  company?: string
  className?: string
}

// "View posting": the job ad, in a new tab. Renders nothing when the application has no
// (safe) link, rather than a dead or disabled one.
export default function PostingLink({ url, company, className = '' }: Props) {
  const href = safePostingUrl(url)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens the job posting in a new tab"
      aria-label={company ? `View posting for ${company}` : undefined}
      className={`link text-sm ${className}`}
    >
      View posting
    </a>
  )
}
