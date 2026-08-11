// User as Code (UaC) — Executable Memory for Personalized Agents.
// Reference implementation of Bojie Li, arXiv:2606.16707 (training-free).
//
// The paradigm: an agent's model of a user is a *living software project*.
// Instead of a "bag of facts" (text snippets / a KG you retrieve over), the
// user is compiled into TYPED STATE plus EXECUTABLE RULES. Two-phase pipeline:
//
//   Phase 1 — Capture:  every observation is appended to an immutable fact log
//                        (nothing is discarded, contradictions included).
//   Phase 2 — Compile:  the log is periodically checkpointed into a typed
//                        `User` object; ordinary functions then compute over it
//                        and fire rules deterministically.
//
// Why it matters (the paper's headline): retrieval can recall isolated facts
// but cannot *compute over history* — totals, counts, dedup, safety rules that
// depend on the whole record. Executable state can, exactly and deterministically.

let _seq = 0
const fid = () => `f${(++_seq).toString(36)}`

/**
 * Typed user state — the "code" a user compiles into. Plain data so it can be
 * serialized, rendered as source (see codegen.js) and computed over (query.js).
 */
export function emptyUser() {
  return {
    allergies: [], // string[]
    medications: [], // { name, dose }[]
    diet: [], // string[]  e.g. 'vegetarian', 'low-sodium'
    purchases: [], // { item, category, amount, t }[]
    budgets: {}, // category -> monthly cap
  }
}

/** A single observation in the append-only log. */
export function makeFact(kind, data, text, t) {
  return { id: fid(), t, kind, data, text }
}

/**
 * Deterministically fold the append-only fact log into typed `User` state.
 * Order matters: later facts update earlier ones (this is where contradictions
 * are *resolved in code*, not left ambiguous like a bag of facts).
 */
export function compile(log) {
  const u = emptyUser()
  const allergies = new Set()
  const meds = new Map() // name -> dose
  const diet = new Set()

  for (const f of log) {
    switch (f.kind) {
      case 'allergy':
        allergies.add(f.data.substance.toLowerCase())
        break
      case 'med_start':
        meds.set(f.data.name.toLowerCase(), f.data.dose || '')
        break
      case 'med_stop':
        meds.delete(f.data.name.toLowerCase())
        break
      case 'diet_set':
        if (f.data.pref === 'none') diet.clear()
        else diet.add(f.data.pref.toLowerCase())
        break
      case 'diet_clear':
        diet.delete((f.data.pref || '').toLowerCase())
        break
      case 'purchase':
        u.purchases.push({ item: f.data.item, category: f.data.category, amount: f.data.amount, t: f.t })
        break
      case 'budget_set':
        u.budgets[f.data.category] = f.data.amount
        break
    }
  }
  u.allergies = [...allergies]
  u.medications = [...meds].map(([name, dose]) => ({ name, dose }))
  u.diet = [...diet]
  return u
}

/**
 * UaCMemory — orchestrates the two-phase pipeline.
 * append() adds to the immutable log; checkpoint() recompiles typed state.
 */
export class UaCMemory {
  constructor() {
    this.log = [] // append-only capture
    this.clock = 0
    this.user = emptyUser() // last compiled checkpoint
    this.lastCheckpointSeq = 0 // log length at last checkpoint
  }

  tick(n = 1) {
    this.clock += n
    return this.clock
  }

  /** Phase 1: capture an observation. Never discards, never overwrites. */
  append(kind, data, text) {
    const f = makeFact(kind, data, text ?? '', this.clock)
    this.log.push(f)
    return f
  }

  /** Number of facts captured but not yet compiled into the checkpoint. */
  pending() {
    return this.log.length - this.lastCheckpointSeq
  }

  /** Phase 2: checkpoint — recompile typed state from the whole log. */
  checkpoint() {
    this.user = compile(this.log)
    this.lastCheckpointSeq = this.log.length
    return this.user
  }
}
