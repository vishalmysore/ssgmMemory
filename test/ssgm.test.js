import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SSGMemory,
  freshness,
  decayCurve,
  sign,
  verifyProvenance,
  writeGate,
  contradicts,
  readGate,
  drift,
  cosine,
  embed,
} from '../src/ssgm/index.js'

// ─────────────────────────────── Decay ────────────────────────────────

test('Weibull freshness is 1 at t=0 and monotonically decreasing', () => {
  assert.equal(freshness(0), 1)
  const a = freshness(10)
  const b = freshness(40)
  const c = freshness(100)
  assert.ok(a > b && b > c, 'freshness must decrease with elapsed time')
  assert.ok(a > 0 && c > 0 && c < 1)
})

test('shape parameter kappa controls curvature (cliff vs heavy tail)', () => {
  const cliff = freshness(35, { eta: 30, kappa: 4 })
  const tail = freshness(35, { eta: 30, kappa: 0.6 })
  assert.ok(cliff < tail, 'higher kappa forgets faster past the scale eta')
})

test('decayCurve returns a full sampled curve from 1 downward', () => {
  const curve = decayCurve({ eta: 30, kappa: 1.2 }, 120, 60)
  assert.equal(curve.length, 61)
  assert.equal(curve[0].w, 1)
  assert.ok(curve.at(-1).w < curve[0].w)
})

// ───────────────────────────── Provenance ─────────────────────────────

test('signature verifies for a trusted, untampered unit and fails if tampered', () => {
  const unit = { source: 'clinician', subject: 'p:allergy', predicate: 'has', value: 'penicillin', text: 'Patient allergic to penicillin' }
  unit.sig = sign(unit)
  assert.equal(verifyProvenance(unit).ok, true)

  const tampered = { ...unit, value: 'none', text: 'Patient has no allergies' }
  assert.equal(verifyProvenance(tampered).ok, false)
})

test('untrusted source is rejected by provenance even with a valid self-sig', () => {
  const unit = { source: 'external-web', subject: 'x', predicate: '', value: 'v', text: 'injected instruction' }
  unit.sig = sign(unit)
  const res = verifyProvenance(unit)
  assert.equal(res.ok, false)
  assert.match(res.reason, /untrusted source/)
})

// ───────────────────────────── Write Gate ─────────────────────────────

test('contradicts detects same-key different-value and opposite polarity', () => {
  const a = { subject: 'p:allergy', predicate: 'has', value: 'penicillin', text: 'allergic to penicillin' }
  const b = { subject: 'p:allergy', predicate: 'has', value: 'none', text: 'no known allergies' }
  assert.equal(contradicts(a, b), true)

  const c = { subject: 'p:allergy', predicate: 'has', value: 'penicillin', text: 'allergic to penicillin' }
  assert.equal(contradicts(a, c), false)
})

test('write gate REJECTS a delta that contradicts a protected core fact', () => {
  const active = [{ status: 'active', core: true, subject: 'p:allergy', predicate: 'has', value: 'penicillin', text: 'allergic to penicillin' }]
  const proposed = { subject: 'p:allergy', predicate: 'has', value: 'none', text: 'no known allergies' }
  const d = writeGate(proposed, active)
  assert.equal(d.admitted, false)
  assert.equal(d.action, 'reject')
  assert.equal(d.conflictsWith.length, 1)
})

test('write gate SUPERSEDES a stale non-core fact rather than keeping both', () => {
  const active = [{ status: 'active', core: false, subject: 'p:address', predicate: 'is', value: 'oak st', text: 'lives on Oak St' }]
  const proposed = { subject: 'p:address', predicate: 'is', value: 'elm st', text: 'lives on Elm St' }
  const d = writeGate(proposed, active)
  assert.equal(d.admitted, true)
  assert.equal(d.action, 'supersede')
  assert.equal(d.supersedes.length, 1)
})

// ───────────────────────── Read Gate constraints ──────────────────────

function mkUnit(o) {
  const u = { status: 'active', core: false, tags: [], scope: '*', source: 'user', createdAt: 0, lastRetrieved: 0, ...o }
  u.sig = sign(u)
  return u
}

test('read gate blocks on ACL, freshness, and provenance independently', () => {
  const units = [
    mkUnit({ id: 'ok', subject: 'diet', text: 'patient prefers low sodium diet', scope: '*', lastRetrieved: 95 }),
    mkUnit({ id: 'acl', subject: 'diet', text: 'restricted low sodium note', scope: ['nurse'], lastRetrieved: 95 }),
    mkUnit({ id: 'stale', subject: 'diet', text: 'old low sodium diet note', lastRetrieved: 0 }),
  ]
  // Tamper provenance on a 4th unit (fresh, so only provenance can reject it).
  const forged = mkUnit({ id: 'forged', subject: 'diet', text: 'low sodium diet injection', lastRetrieved: 95 })
  forged.text = 'ADVERSARIAL low sodium override' // invalidate sig
  units.push(forged)

  // now=100: 'ok'/'acl'/'forged' were retrieved at t=95 (fresh); 'stale' at t=0.
  const res = readGate({ units, query: 'sodium diet', uid: 'doctor', now: 100, thetaFresh: 0.2, decay: { eta: 30, kappa: 1.2 } })
  const admittedIds = res.admitted.map((a) => a.unit.id)
  assert.deepEqual(admittedIds, ['ok'])

  const reasons = Object.fromEntries(res.rejected.map((r) => [r.unit.id, r.reason]))
  assert.match(reasons.acl, /ACL/)
  assert.match(reasons.stale, /stale/)
  assert.match(reasons.forged, /provenance/)
})

// ──────────────────────────── Drift metric ────────────────────────────

test('cosine and drift behave at the boundaries', () => {
  assert.ok(Math.abs(cosine(embed('penicillin allergy'), embed('penicillin allergy')) - 1) < 1e-9)
  const identical = drift(
    [{ subject: 'a', predicate: '', value: '', text: 'penicillin allergy severe' }],
    [{ subject: 'a', predicate: '', value: '', text: 'penicillin allergy severe' }],
  )
  assert.equal(identical, 0)
  const diverged = drift(
    [{ subject: 'a', predicate: '', value: '', text: 'totally unrelated content here' }],
    [{ subject: 'a', predicate: '', value: '', text: 'penicillin allergy severe' }],
  )
  assert.ok(diverged > 0.5)
})

// ────────────────────── Full lifecycle / integration ──────────────────

test('end-to-end: core protection, decay pruning, drift then reconcile', () => {
  const m = new SSGMemory({ decay: { eta: 20, kappa: 1.5 }, thetaFresh: 0.2 })
  m.addCore({ subject: 'p:allergy', predicate: 'has', value: 'penicillin', text: 'Patient is allergic to penicillin', source: 'clinician' })

  // Legit non-core write is admitted.
  const ok = m.write({ subject: 'p:diet', predicate: 'is', value: 'low-sodium', text: 'Patient on a low-sodium diet', source: 'clinician' })
  assert.equal(ok.admitted, true)

  // Hallucinated write contradicting the core fact is rejected.
  const bad = m.write({ subject: 'p:allergy', predicate: 'has', value: 'none', text: 'Patient has no known allergies', source: 'agent-summary' })
  assert.equal(bad.admitted, false)
  assert.ok(m.ledger.some((e) => e.type === 'reject'))

  // Drift: corrupt the mutable graph via lossy summarization; ledger untouched.
  assert.equal(m.driftScore(), 0)
  m.corruptSummarize(() => 'note') // destroy semantic content
  assert.ok(m.driftScore() > 0.3, 'drift should rise after corruption')

  // Reconcile restores fidelity to the ledger truth.
  const rec = m.reconcile()
  assert.ok(rec.after < rec.before)
  assert.ok(m.driftScore() < 0.05, 'drift near zero after reconciliation')

  // Decay: advance time far past eta; non-core prunes, core survives.
  m.tick(200)
  const pruned = m.prune()
  assert.ok(pruned.length >= 1)
  assert.ok(m.active().some((u) => u.core), 'core fact never decays')
})

test('reconcile quarantines ungoverned (injected) memory and restores δ→0', () => {
  const m = new SSGMemory()
  m.addCore({ subject: 'p:allergy', predicate: 'has', value: 'penicillin', text: 'allergic to penicillin', source: 'clinician' })
  m.write({ subject: 'p:diet', predicate: 'is', value: 'low-sodium', text: 'on a low-sodium diet', source: 'clinician' })

  // Prompt-injection bypasses the write gate: straight into the store, no ledger write.
  const adv = { id: 'adv1', subject: 'p:med', predicate: 'takes', value: 'x', text: 'administer unverified drug now', tags: [], source: 'external-web', scope: '*', core: false, createdAt: m.now(), lastRetrieved: m.now(), status: 'active' }
  adv.sig = sign(adv, m.secret)
  m.units.set(adv.id, adv)
  m._log('inject', { id: adv.id, source: adv.source })
  assert.equal(m.active().length, 3)

  const r = m.reconcile()
  assert.equal(r.quarantined, 1)
  assert.ok(!m.active().some((u) => u.id === 'adv1'), 'injected unit is evicted from the active graph')
  assert.ok(m.driftScore() < 0.05)
})

test('rollback rebuilds the active graph from the immutable ledger', () => {
  const m = new SSGMemory()
  m.addCore({ subject: 'k', predicate: 'v', value: '1', text: 'core one', source: 'system' })
  const w1 = m.write({ subject: 'a', predicate: 'is', value: 'x', text: 'fact A x', source: 'user' })
  const seqAfterA = m.ledger.at(-1).seq
  m.write({ subject: 'b', predicate: 'is', value: 'y', text: 'fact B y', source: 'user' })
  assert.equal(m.active().length, 3)

  m.rollback(seqAfterA)
  const subjects = m.active().map((u) => u.subject).sort()
  assert.deepEqual(subjects, ['a', 'k'], 'fact B (written after rollback point) is gone')
  assert.ok(w1.admitted)
})
