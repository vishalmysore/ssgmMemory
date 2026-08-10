// Provenance — source authentication for memory units (SSGM Read Gate).
//
// The Read Filtering Gate requires a provenance signature σ(μ) proving that a
// memory unit was produced by a trusted source rather than injected by an
// adversarial prompt. A real deployment would use asymmetric cryptography;
// here we use a deterministic keyed digest (FNV-1a over the unit's immutable
// fields) as a demonstrative stand-in — the governance logic is identical.

// Sources the agent is willing to consolidate / retrieve from.
export const TRUSTED_SOURCES = Object.freeze([
  'clinician',
  'user',
  'verified-tool',
  'agent-summary',
  'system',
])

// Deterministic 32-bit FNV-1a digest, hex encoded.
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// The signed payload = the fields that must not be forged after write.
function payload(unit, secret) {
  return [secret, unit.source, unit.subject, unit.predicate ?? '', unit.value ?? '', unit.text]
    .join('␟')
}

/** Produce σ(μ) for a unit. */
export function sign(unit, secret = 'ssgm-demo-key') {
  return fnv1a(payload(unit, secret))
}

/** Verify the signature and that the source is trusted. */
export function verifyProvenance(unit, { secret = 'ssgm-demo-key', trusted = TRUSTED_SOURCES } = {}) {
  if (!unit.source || !trusted.includes(unit.source)) {
    return { ok: false, reason: `untrusted source "${unit.source ?? '∅'}"` }
  }
  if (unit.sig !== sign(unit, secret)) {
    return { ok: false, reason: 'signature mismatch (unit was tampered or forged)' }
  }
  return { ok: true }
}
