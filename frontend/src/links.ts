// The job posting link is user-entered text, and it becomes a clickable link. Only http(s) may:
// a stored "javascript:..." value would run script when clicked. The API refuses anything
// else, and every place that renders the link checks again here, so a bad value that got
// into the database some other way still could not become a script-running link.
export function safePostingUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null
}
