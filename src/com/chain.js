// Chain construction — the "sophisticated utilization" half of CoM.
//
// Naive RAG concatenates the Top-K units most similar to the query and hopes
// the reasoning survives. CoM instead assembles an ORDERED inference pathway:
// it seeds from the unit most relevant to the query, then repeatedly hops to
// whichever remaining unit best *connects* to the chain frontier while still
// pulling toward the query. This surfaces BRIDGE fragments that a query-only
// Top-K misses — the intermediate hops whose words don't match the question
// but which link the answer together. Adaptive truncation ends the chain when
// no candidate connects strongly enough.

import { embed, cosine } from './embed.js'
import { unitEmbed } from './store.js'

const LINK_W = 0.7 // weight on frontier-connection strength
const GOAL_W = 0.3 // weight on pull toward the query

/**
 * Build a Chain-of-Memory for `query` over `units`.
 * @returns {{ hops: {unit,link,goal,score}[], seed, stoppedBy }}
 */
export function buildChain(query, units, { maxHops = 5, threshold = 0.12 } = {}) {
  if (units.length === 0) return { hops: [], seed: null, stoppedBy: 'empty' }
  const q = embed(query)
  const rel = new Map(units.map((u) => [u.id, cosine(q, unitEmbed(u))]))

  // Seed: the unit most relevant to the query.
  const seed = units.reduce((best, u) => (rel.get(u.id) > rel.get(best.id) ? u : best))
  const hops = [{ unit: seed, link: 1, goal: rel.get(seed.id), score: rel.get(seed.id) }]
  const used = new Set([seed.id])
  let stoppedBy = 'maxHops'

  while (hops.length < maxHops) {
    const frontier = hops[hops.length - 1].unit
    const fEmb = unitEmbed(frontier)
    let best = null
    for (const u of units) {
      if (used.has(u.id)) continue
      const link = cosine(fEmb, unitEmbed(u)) // connection to the chain frontier
      const goal = rel.get(u.id) // pull toward the query
      const score = LINK_W * link + GOAL_W * goal
      if (!best || score > best.score) best = { unit: u, link, goal, score }
    }
    if (!best || best.score < threshold) { stoppedBy = 'adaptive-truncation'; break }
    hops.push(best)
    used.add(best.unit.id)
  }
  return { hops, seed, stoppedBy }
}

/** Naive RAG baseline: Top-K by query similarity, unordered. */
export function naiveTopK(query, units, { k = 3 } = {}) {
  const q = embed(query)
  return units
    .map((u) => ({ unit: u, sim: cosine(q, unitEmbed(u)) }))
    .filter((x) => x.sim > 0)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k)
}

/** Rough token estimate (word count) of a set of units — for the cost view. */
export function tokenCost(units) {
  return units.reduce((n, u) => n + String(u.content).split(/\s+/).length, 0)
}
