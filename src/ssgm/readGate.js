// Read Filtering Gate (SSGM Read Phase — Constrained Retrieval).
//
//   C_t = { μ ∈ Top-K(q_t, M_{t-1}) | ACL(μ, uid) ∧ ( w(Δτ_μ) ≥ θ_fresh ) ∧ prov(μ) }
//
// Before any candidate reaches the agent's context window it must pass three
// independent constraints:
//   • ACL(μ, uid)        attribute-based access control (Principle 3)
//   • w(Δτ_μ) ≥ θ_fresh  temporal freshness — stale memories are pruned
//   • prov(μ)            trusted provenance signature σ(μ)
// then the survivors are ranked by lexical relevance to the query (Top-K).

import { unitFreshness } from './decay.js'
import { verifyProvenance } from './provenance.js'

/** ABAC predicate: may `uid` read unit μ? Scope '*'/'public' is world-readable. */
export function acl(unit, uid) {
  const scope = unit.scope ?? '*'
  if (scope === '*' || scope === 'public') return true
  if (Array.isArray(scope)) return scope.includes(uid)
  return scope === uid
}

function relevance(unit, queryTerms) {
  if (queryTerms.length === 0) return 1
  const hay = `${unit.text} ${unit.subject ?? ''} ${(unit.tags ?? []).join(' ')}`.toLowerCase()
  let hits = 0
  for (const q of queryTerms) if (hay.includes(q)) hits++
  return hits / queryTerms.length
}

/**
 * @param {object} args
 * @param {object[]} args.units      active memory units
 * @param {string}   args.query      retrieval query
 * @param {string}   args.uid        requesting identity
 * @param {number}   args.now        current logical/wall time
 * @param {number}   [args.thetaFresh=0.15] freshness threshold θ_fresh
 * @param {number}   [args.topK=5]
 * @param {object}   [args.decay]    decay params {eta,kappa}
 * @returns {{admitted:object[], rejected:{unit:object,reason:string}[]}}
 */
export function readGate({ units, query, uid, now, thetaFresh = 0.15, topK = 5, decay }) {
  const queryTerms = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)

  const admitted = []
  const rejected = []

  for (const unit of units) {
    if (unit.status !== 'active') {
      rejected.push({ unit, reason: `status=${unit.status}` })
      continue
    }
    if (!acl(unit, uid)) {
      rejected.push({ unit, reason: `ACL: "${uid}" not in scope` })
      continue
    }
    const prov = verifyProvenance(unit)
    if (!prov.ok) {
      rejected.push({ unit, reason: `provenance: ${prov.reason}` })
      continue
    }
    const w = unitFreshness(unit, now, decay)
    if (w < thetaFresh) {
      rejected.push({ unit, reason: `stale: w=${w.toFixed(3)} < θ_fresh=${thetaFresh}` })
      continue
    }
    const rel = relevance(unit, queryTerms)
    if (rel === 0) {
      rejected.push({ unit, reason: 'no lexical relevance to query' })
      continue
    }
    admitted.push({ unit, w, relevance: rel, score: rel * w })
  }

  admitted.sort((a, b) => b.score - a.score)
  return { admitted: admitted.slice(0, topK), rejected }
}
