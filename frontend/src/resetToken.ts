// The link in the reset email is /reset-password#token=... The token is in the fragment
// (after the #), which browsers never send to a server and never put in a Referer
// header, so it stays out of server logs and other sites' analytics.
export function tokenFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') || null
}
