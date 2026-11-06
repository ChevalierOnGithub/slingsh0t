/** How long ago an ISO timestamp was, in words: '5m ago', 'yesterday', '2 weeks ago'. */
export function ago(iso: string, now = Date.now()): string {
  const m = Math.floor((now - Date.parse(iso)) / 60_000)
  if (m < 1) return 'just now' // also a stamp slightly in the future (clock skew)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 2) return 'yesterday'
  if (d < 14) return `${d} days ago`
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`
  const mo = Math.floor(d / 30)
  return mo === 1 ? '1 month ago' : `${mo} months ago`
}
