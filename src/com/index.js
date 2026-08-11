// Chain-of-Memory (CoM) public API barrel — arXiv:2601.14287.
export { ChainOfMemory, CoMStore } from './core.js'
export { buildChain, naiveTopK, tokenCost } from './chain.js'
export { makeUnit, unitEmbed } from './store.js'
export { embed, cosine, sim, terms } from './embed.js'
