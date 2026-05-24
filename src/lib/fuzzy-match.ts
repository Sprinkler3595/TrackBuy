/**
 * Normalize a string for fuzzy comparison: lowercase, strip accents and
 * non-alphanumerics, collapse whitespace. "L'Apple Store!" → "lapple store".
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Find the best merchant match for a free-text name extracted from a receipt.
 * Strategy: exact normalized match → either-direction substring match → pick
 * the candidate with the closest length. Returns null if no candidate is
 * meaningfully similar (avoids returning a 2-letter match against a 50-char
 * merchant name).
 */
export function findMerchantByName<T extends { id: string; name: string }>(
  query: string,
  candidates: T[],
): T | null {
  const q = normalizeName(query)
  if (q.length < 2) return null

  const annotated = candidates.map((c) => ({ c, n: normalizeName(c.name) }))

  const exact = annotated.find(({ n }) => n === q)
  if (exact) return exact.c

  const matches = annotated.filter(({ n }) => {
    if (n.length < 2) return false
    return n.includes(q) || q.includes(n)
  })
  if (matches.length === 0) return null

  matches.sort((a, b) => Math.abs(a.n.length - q.length) - Math.abs(b.n.length - q.length))
  return matches[0].c
}
