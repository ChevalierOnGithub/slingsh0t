/** How long ago an ISO timestamp was, in words: '5m ago', 'yesterday', '2 weeks ago'. */
export function ago(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  const m = Math.floor((now - then) / 60_000)
  if (m < 1) return 'just now' // also a stamp slightly in the future (clock skew)
  if (m < 60) return `${m}m ago`
  // Past a day, count calendar days in local time: "yesterday" is the day before today, not 24 to 48 hours back.
  const d = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86_400_000)
  if (m < 24 * 60 || d < 1) return `${Math.floor(m / 60)}h ago`
  if (d < 2) return 'yesterday'
  if (d < 14) return `${d} days ago`
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`
  const mo = Math.floor(d / 30)
  return mo === 1 ? '1 month ago' : `${mo} months ago`
}
