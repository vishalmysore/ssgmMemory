// Lightweight memory store for Chain-of-Memory (arXiv:2601.14287).
//
// CoM's first half is "lightweight construction": rather than building an
// expensive graph (entity/relation extraction per turn), each interaction is
// distilled into a small memory UNIT — core content + cheap metadata
// (timestamp, importance, access count) + an embedding computed on demand.
// The second half ("sophisticated utilization") lives in chain.js.

import { embed } from './embed.js'

let _seq = 0
const uid = () => `u${(++_seq).toString(36)}`

/** Create a distilled memory unit. */
export function makeUnit({ content, importance = 0.5, t = 0, tags = [] }) {
  return {
    id: uid(),
    content,
    tags,
    t, // creation time
    importance, // task-relevance prior in [0,1]
    access: 0, // how often this unit has been used in a chain
    lastAccess: t,
    _emb: null, // lazily cached embedding
  }
}

export function unitEmbed(u) {
  return (u._emb ||= embed(`${u.content} ${u.tags.join(' ')}`))
}

export class CoMStore {
  constructor({ capacity = 12, halfLife = 40 } = {}) {
    this.units = []
    this.capacity = capacity
    this.halfLife = halfLife // recency decay half-life
    this.clock = 0
  }

  tick(n = 1) {
    this.clock += n
    return this.clock
  }

  add(spec) {
    const u = makeUnit({ t: this.clock, ...spec })
    this.units.push(u)
    return u
  }

  all() {
    return this.units
  }

  /**
   * Adaptive-truncation retention score:
   *   importance × recency-decay × (1 + log(1+access))
   * Old, low-importance, rarely-used units score lowest and are pruned first.
   */
  score(u, now = this.clock) {
    const recency = Math.pow(0.5, (now - u.lastAccess) / this.halfLife)
    return u.importance * recency * (1 + Math.log(1 + u.access))
  }

  /** Dynamic evolution: reinforce units that were used in a chosen chain. */
  reinforce(units) {
    for (const u of units) {
      u.access += 1
      u.lastAccess = this.clock
      u.importance = Math.min(1, u.importance + 0.08)
    }
  }

  /**
   * Adaptive truncation / capacity management: when the store exceeds capacity,
   * drop the lowest-scoring units. Returns the pruned units.
   */
  truncate() {
    if (this.units.length <= this.capacity) return []
    const ranked = [...this.units].sort((a, b) => this.score(b) - this.score(a))
    const keep = ranked.slice(0, this.capacity)
    const pruned = ranked.slice(this.capacity)
    this.units = this.units.filter((u) => keep.includes(u))
    return pruned
  }
}
