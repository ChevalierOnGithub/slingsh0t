const toInt = (ip: string): number | null => {
  const p = ip.split('.')
  // No leading zeros: '010' reads as octal in some tools, so it's ambiguous.
  if (p.length !== 4 || p.some((x) => !/^(0|[1-9]\d{0,2})$/.test(x) || +x > 255)) return null
  return p.reduce((n, x) => n * 256 + +x, 0)
}
export const isCidr = (s: string): boolean => {
  const m = /^(.+)\/(0|[1-9]\d?)$/.exec(s)
  return !!m && toInt(m[1]) !== null && +m[2] <= 32
}
export const cidrContains = (cidr: string, ip: string): boolean => {
  if (!isCidr(cidr)) return false
  const [base, bits] = cidr.split('/')
  const a = toInt(base), b = toInt(ip)
  if (a === null || b === null) return false
  const size = 2 ** (32 - +bits)
  return Math.floor(a / size) === Math.floor(b / size)
}
