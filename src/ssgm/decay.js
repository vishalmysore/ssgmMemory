// Temporal decay model — Weibull freshness weighting (SSGM §Decay).
//
// The paper models the freshness of a memory unit as a Weibull survival
// function of the time elapsed since its last successful retrieval:
//
//     w(Δτ) = exp( -(Δτ / η)^κ )
//
//   Δτ : elapsed time since last successful retrieval (reinforcement)
//   η  : scale parameter  — the characteristic timescale of the memory
//   κ  : shape parameter  — curvature; κ<1 heavy-tailed, κ=1 exponential,
//                           κ>1 "cliff"-like forgetting
//
// w ∈ (0, 1].  Units whose weight falls below a freshness threshold θ_fresh
// are pruned from retrieval candidates before they reach the agent context.

export const DEFAULT_DECAY = Object.freeze({ eta: 30, kappa: 1.2 })

/**
 * Weibull freshness weight.
 * @param {number} deltaTau  elapsed time since last retrieval (same unit as eta)
 * @param {{eta:number,kappa:number}} [params]
 * @returns {number} freshness weight in (0, 1]
 */
export function freshness(deltaTau, params = DEFAULT_DECAY) {
  const { eta, kappa } = params
  if (deltaTau <= 0) return 1
  if (eta <= 0) return 0
  return Math.exp(-Math.pow(deltaTau / eta, kappa))
}

/**
 * Freshness weight for a memory unit at logical/wall time `now`.
 * Core facts never decay (they are the protected ground set M_core).
 */
export function unitFreshness(unit, now, params = DEFAULT_DECAY) {
  if (unit.core) return 1
  const last = unit.lastRetrieved ?? unit.createdAt ?? now
  return freshness(now - last, params)
}

/**
 * Sample the decay curve for plotting.
 * @returns {{t:number,w:number}[]}
 */
export function decayCurve(params = DEFAULT_DECAY, tMax = 120, steps = 60) {
  const out = []
  for (let i = 0; i <= steps; i++) {
    const t = (tMax * i) / steps
    out.push({ t, w: freshness(t, params) })
  }
  return out
}
