// Chain-of-Memory orchestrator — ties the lightweight store to chain-based
// utilization, dynamic evolution, and adaptive truncation.

import { CoMStore } from './store.js'
import { buildChain, naiveTopK, tokenCost } from './chain.js'

export class ChainOfMemory {
  constructor(opts = {}) {
    this.store = new CoMStore(opts)
  }

  tick(n = 1) {
    return this.store.tick(n)
  }

  /** Lightweight construction: distill an interaction into a memory unit. */
  remember(spec) {
    return this.store.add(spec)
  }

  /**
   * Answer a query two ways and evolve the memory.
   *  - chain:  ordered Chain-of-Memory pathway (sophisticated utilization)
   *  - naive:  Top-K concatenation baseline
   * The units traversed by the chain are reinforced (dynamic evolution).
   */
  query(text, { k = 3, maxHops = 5, threshold = 0.12, evolve = true } = {}) {
    const units = this.store.all()
    const chain = buildChain(text, units, { maxHops, threshold })
    const naive = naiveTopK(text, units, { k })

    const chainUnits = chain.hops.map((h) => h.unit)
    if (evolve) this.store.reinforce(chainUnits)

    return {
      chain,
      naive,
      cost: {
        chainTokens: tokenCost(chainUnits),
        naiveTokens: tokenCost(naive.map((n) => n.unit)),
      },
      // Bridge units: in the chain's reasoning path but NOT in the naive Top-K.
      bridges: chainUnits.filter((u) => !naive.some((n) => n.unit.id === u.id)),
    }
  }

  /** Adaptive truncation pass (capacity management). */
  consolidate() {
    return this.store.truncate()
  }
}

export { CoMStore } from './store.js'
