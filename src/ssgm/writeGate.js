// Write Validation Gate  𝒢_write  (SSGM Write Phase).
//
//     M_t = M_{t-1} ∪ 𝒢_write( Agent(C_t), M_core )
//
// A Truth-Maintenance-System check: a proposed memory delta is only admitted if
// it does not entail a contradiction with the protected core facts M_core:
//
//     ΔM ∧ M_core ⊧ ⊥   →  REJECT
//
// Contradiction is detected two ways (a training-free NLI-lite):
//   1. Structured: same fact key (subject|predicate) asserting a different value.
//   2. Lexical negation: the delta negates a statement an existing unit affirms.
//
// A conflict against a CORE fact is rejected outright (prevents hallucination
// cascades from corrupting the semantic graph). A conflict against a mutable,
// non-core fact is a legitimate update: the old unit is superseded, not kept
// side-by-side, so the graph never holds both P and ¬P.

export function factKey(unit) {
  return `${(unit.subject ?? '').toLowerCase()}|${(unit.predicate ?? '').toLowerCase()}`
}

const NEG = /\b(no longer|not|never|isn'?t|aren'?t|without|denies?|negative for|ruled out)\b/i

function polarity(text) {
  return NEG.test(String(text)) ? -1 : 1
}

/**
 * Does the proposed unit contradict `existing`?
 * Same fact key + (different value OR opposite polarity) ⇒ contradiction.
 */
export function contradicts(proposed, existing) {
  if (factKey(proposed) !== factKey(existing)) return false
  const pv = String(proposed.value ?? '').toLowerCase().trim()
  const ev = String(existing.value ?? '').toLowerCase().trim()
  if (pv && ev) return pv !== ev
  // No structured value to compare — fall back to text polarity.
  return polarity(proposed.text) !== polarity(existing.text)
}

/**
 * Run the gate against the current active units.
 * @returns {{admitted:boolean, action:'admit'|'reject'|'supersede',
 *            reason:string, conflictsWith:object[], supersedes:object[]}}
 */
export function writeGate(proposed, activeUnits) {
  const conflicts = activeUnits.filter((u) => u.status === 'active' && contradicts(proposed, u))

  if (conflicts.length === 0) {
    return { admitted: true, action: 'admit', reason: 'no conflict with existing memory', conflictsWith: [], supersedes: [] }
  }

  const coreConflicts = conflicts.filter((u) => u.core)
  if (coreConflicts.length > 0) {
    return {
      admitted: false,
      action: 'reject',
      reason: `contradicts protected core fact "${coreConflicts[0].text}" (ΔM ∧ M_core ⊧ ⊥)`,
      conflictsWith: coreConflicts,
      supersedes: [],
    }
  }

  // Non-core conflict: admit as an update that supersedes the stale unit(s).
  return {
    admitted: true,
    action: 'supersede',
    reason: `updates ${conflicts.length} stale non-core fact(s)`,
    conflictsWith: conflicts,
    supersedes: conflicts,
  }
}
