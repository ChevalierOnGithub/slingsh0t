/** GitHub's heading id: lower-case, trim, keep letters, digits, spaces and hyphens, spaces to `-`. */
export const headingSlug = (text: string) => text.toLowerCase().trim().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-')

/** One per document: repeats get `-1`, `-2`, … the way github-slugger counts them. */
export const slugger = () => {
  const seen = new Map<string, number>()
  return (text: string) => {
    const base = headingSlug(text)
    let slug = base
    while (seen.has(slug)) {
      const n = seen.get(base)! + 1
      seen.set(base, n)
      slug = `${base}-${n}`
    }
    seen.set(slug, 0)
    return slug
  }
}
