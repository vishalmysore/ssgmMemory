// Training-free semantic primitive for Chain-of-Memory.
// Bag-of-terms frequency vectors + cosine similarity — no model, no weights.
// Kept local to src/com/ so the CoM tab is self-contained.

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or', 'in',
  'on', 'for', 'with', 'no', 'not', 'has', 'have', 'had', 'be', 'as', 'at',
  'by', 'this', 'that', 'it', 'from', 'their', 'my', 'i', 'you', 'me', 'will',
  'can', 'do', 'does', 'what', 'when', 'how', 'they',
])

export function terms(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

export function embed(text) {
  const v = new Map()
  for (const t of terms(text)) v.set(t, (v.get(t) || 0) + 1)
  return v
}

export function cosine(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let dot = 0
  for (const [t, av] of a) {
    const bv = b.get(t)
    if (bv) dot += av * bv
  }
  let na = 0
  for (const av of a.values()) na += av * av
  let nb = 0
  for (const bv of b.values()) nb += bv * bv
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb))
  return c > 1 - 1e-9 ? 1 : c < 1e-9 ? 0 : c
}

/** Convenience: similarity between two raw strings. */
export function sim(a, b) {
  return cosine(embed(a), embed(b))
}
