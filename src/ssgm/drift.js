// Semantic drift metric (SSGM Eq. 4).
//
//     δ(M_T, K_true) = 1 − sim( E(M_T), E(K_true) )
//
// E(·) projects a memory set into a fixed embedding space; sim(·,·) is cosine
// similarity. Training-free by design: E is a bag-of-terms frequency vector, so
// the whole metric is deterministic pure logic — no model, no weights.
//
// Drift ∈ [0, 1]. 0 = the mutable active graph still says exactly what the
// immutable ledger (ground truth K_true) recorded; →1 = it has drifted away
// through lossy re-summarization / corruption.

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or', 'in',
  'on', 'for', 'with', 'no', 'not', 'has', 'have', 'had', 'be', 'as', 'at',
  'by', 'this', 'that', 'it', 'from', 'their',
])

/** Tokenize into content terms. */
function terms(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

/** E(·): project text into a term-frequency vector. */
export function embed(text) {
  const v = new Map()
  for (const t of terms(text)) v.set(t, (v.get(t) || 0) + 1)
  return v
}

/** Cosine similarity between two term-frequency vectors. Clamped to [0,1]. */
export function cosine(a, b) {
  if (a.size === 0 && b.size === 0) return 1
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
  // Snap away floating-point noise so identical vectors score exactly 1.
  if (c > 1 - 1e-9) return 1
  if (c < 1e-9) return 0
  return c
}

const key = (u) => `${(u.subject ?? '').toLowerCase()}|${(u.predicate ?? '').toLowerCase()}`

/** Canonical text of a fact set (order-independent). */
export function canonicalText(units) {
  return units
    .map((u) => `${u.subject} ${u.predicate ?? ''} ${u.value ?? ''} ${u.text}`)
    .sort()
    .join(' \n ')
}

/**
 * Semantic drift δ(M_T, K_true).
 *
 * Computed per fact: for every active unit we compare the narrative text now
 * held in the mutable graph against the same fact's text in the immutable
 * ledger (the field that degrades under iterative re-summarization), and
 * average the fidelity. δ = 1 − mean cosine. Localizing per fact keeps a single
 * corrupted memory from being masked by the rest of the graph. If no facts line
 * up by key, fall back to a whole-set comparison.
 *
 * @param {object[]} activeUnits   the mutable active graph M_T
 * @param {object[]} truthUnits    the ledger ground truth K_true
 * @returns {number} drift in [0, 1]
 */
export function drift(activeUnits, truthUnits) {
  const truth = new Map(truthUnits.map((u) => [key(u), u]))
  const sims = []
  for (const u of activeUnits) {
    const t = truth.get(key(u))
    if (t) sims.push(cosine(embed(u.text), embed(t.text)))
  }
  if (sims.length === 0) {
    const sim = cosine(embed(canonicalText(activeUnits)), embed(canonicalText(truthUnits)))
    return Math.max(0, Math.min(1, 1 - sim))
  }
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length
  return Math.max(0, Math.min(1, 1 - mean))
}
