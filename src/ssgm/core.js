// SSGM — Stability & Safety Governed Memory.
//
// A conceptual governance architecture that DECOUPLES memory evolution from
// execution (Lam, Li, Zhang & Zhao, arXiv:2603.11768). This is a training-free
// implementation: pure logic layered over an existing key/value store.
//
// Dual-track storage substrate:
//   • Mutable Active Graph   (this.units)  — fast semantic reasoning surface
//   • Immutable Episodic Log (this.ledger) — append-only operational truth K_true
//
// Every governed operation (write/reject/retrieve/prune/reconcile/rollback)
// is recorded in the ledger, which is the source of truth used to bound drift
// and to roll back after behavioural degradation.

import { unitFreshness, DEFAULT_DECAY } from './decay.js'
import { sign } from './provenance.js'
import { writeGate, factKey } from './writeGate.js'
import { readGate } from './readGate.js'
import { drift } from './drift.js'

let _seq = 0
const uid = () => `m${(++_seq).toString(36)}${Date.now().toString(36).slice(-3)}`

export class SSGMemory {
  constructor(opts = {}) {
    this.units = new Map() // id -> unit  (mutable active graph M_t)
    this.ledger = [] // append-only immutable episodic log K_ledger
    this.clock = 0 // logical time
    this.decay = opts.decay ?? DEFAULT_DECAY
    this.thetaFresh = opts.thetaFresh ?? 0.15
    this.secret = opts.secret ?? 'ssgm-demo-key'
  }

  now() {
    return this.clock
  }

  tick(n = 1) {
    this.clock += n
    return this.clock
  }

  _log(type, entry) {
    this.ledger.push({ seq: this.ledger.length, t: this.clock, type, ...entry })
  }

  _mkUnit(input, { core = false } = {}) {
    const unit = {
      id: input.id ?? uid(),
      subject: input.subject ?? '',
      predicate: input.predicate ?? '',
      value: input.value ?? '',
      text: input.text ?? '',
      tags: input.tags ?? [],
      source: input.source ?? 'user',
      scope: input.scope ?? '*',
      core,
      createdAt: this.clock,
      lastRetrieved: this.clock,
      status: 'active',
    }
    unit.sig = sign(unit, this.secret)
    return unit
  }

  /** Seed a protected core fact (enters M_core; bypasses the write gate). */
  addCore(input) {
    const unit = this._mkUnit(input, { core: true })
    this.units.set(unit.id, unit)
    this._log('core', { unit: { ...unit } })
    return unit
  }

  /** Governed write: proposed delta → 𝒢_write → (admit | reject | supersede). */
  write(input) {
    const proposed = this._mkUnit(input)
    const decision = writeGate(proposed, [...this.units.values()])

    if (!decision.admitted) {
      this._log('reject', { unit: { ...proposed }, reason: decision.reason })
      return { admitted: false, unit: proposed, decision }
    }

    for (const stale of decision.supersedes) {
      stale.status = 'superseded'
      this._log('supersede', { id: stale.id, by: proposed.id })
    }
    this.units.set(proposed.id, proposed)
    this._log('write', { unit: { ...proposed }, action: decision.action })
    return { admitted: true, unit: proposed, decision }
  }

  /** Constrained retrieval through the Read Filtering Gate. */
  retrieve(query, requester = '*') {
    const res = readGate({
      units: [...this.units.values()],
      query,
      uid: requester,
      now: this.clock,
      thetaFresh: this.thetaFresh,
      decay: this.decay,
    })
    // Successful retrieval reinforces freshness (resets Δτ).
    for (const { unit } of res.admitted) {
      unit.lastRetrieved = this.clock
    }
    this._log('retrieve', {
      query,
      requester,
      admitted: res.admitted.map((a) => a.unit.id),
      rejected: res.rejected.length,
    })
    return res
  }

  /** Prune units whose freshness has fallen below θ_fresh. */
  prune() {
    const pruned = []
    for (const unit of this.units.values()) {
      if (unit.core || unit.status !== 'active') continue
      if (unitFreshness(unit, this.clock, this.decay) < this.thetaFresh) {
        unit.status = 'pruned'
        pruned.push(unit.id)
        this._log('prune', { id: unit.id })
      }
    }
    return pruned
  }

  active() {
    return [...this.units.values()].filter((u) => u.status === 'active')
  }

  /** Freshness-annotated snapshot of the active graph (for the UI). */
  snapshot() {
    return this.active().map((u) => ({ ...u, w: unitFreshness(u, this.clock, this.decay) }))
  }

  /** Reconstruct K_true (ground-truth fact set) from the immutable ledger. */
  truthUnits() {
    const byKey = new Map()
    for (const e of this.ledger) {
      if (e.type === 'write' || e.type === 'core') {
        byKey.set(factKey(e.unit), { ...e.unit, status: 'active' })
      } else if (e.type === 'supersede') {
        // superseding write for the same key arrives as its own 'write' event;
        // nothing to do here beyond ordering, which the loop already respects.
      }
    }
    return [...byKey.values()]
  }

  /** Current semantic drift δ(M_T, K_true). */
  driftScore() {
    return drift(this.active(), this.truthUnits())
  }

  /**
   * Simulate lossy iterative re-summarization on the MUTABLE graph only.
   * This is the failure mode SSGM guards against — the ledger is untouched, so
   * drift becomes observable and reconciliation can repair it.
   */
  corruptSummarize(transform) {
    for (const u of this.units.values()) {
      if (u.core || u.status !== 'active') continue
      u.text = transform(u.text, u)
    }
  }

  /**
   * Reconciliation: realign the mutable graph to the immutable ledger truth.
   * Governed units are restored to their ledger text; active non-core units
   * that never came through the governed write path (e.g. prompt-injected
   * memory) have no ledger counterpart and are quarantined out of the graph.
   */
  reconcile() {
    const before = this.driftScore()

    // Latest governed snapshot per unit id, from the immutable ledger.
    const governed = new Map()
    for (const e of this.ledger) {
      if (e.type === 'core' || e.type === 'write') governed.set(e.unit.id, e.unit)
    }

    let quarantined = 0
    for (const u of this.units.values()) {
      if (u.core || u.status !== 'active') continue
      const g = governed.get(u.id)
      if (!g) {
        u.status = 'quarantined'
        quarantined++
        this._log('quarantine', { id: u.id, reason: 'no governed ledger provenance' })
        continue
      }
      u.text = g.text
      u.value = g.value
      u.subject = g.subject
      u.predicate = g.predicate
      u.sig = sign(u, this.secret)
    }

    const after = this.driftScore()
    this._log('reconcile', { before, after, quarantined })
    return { before, after, quarantined }
  }

  /**
   * Rollback: rebuild the mutable graph by replaying the ledger up to `toSeq`,
   * discarding any state after it (recovery from behavioural degradation).
   */
  rollback(toSeq) {
    const rebuilt = new Map()
    for (const e of this.ledger) {
      if (e.seq > toSeq) break
      if (e.type === 'core' || e.type === 'write') {
        rebuilt.set(e.unit.id, { ...e.unit, status: 'active' })
      } else if (e.type === 'supersede') {
        const s = rebuilt.get(e.id)
        if (s) s.status = 'superseded'
      } else if (e.type === 'prune') {
        const s = rebuilt.get(e.id)
        if (s) s.status = 'pruned'
      }
    }
    this.units = rebuilt
    this._log('rollback', { toSeq })
    return this.active()
  }
}

export { DEFAULT_DECAY } from './decay.js'
