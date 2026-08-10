// SSGM public API barrel.
export { SSGMemory, DEFAULT_DECAY } from './core.js'
export { freshness, unitFreshness, decayCurve } from './decay.js'
export { sign, verifyProvenance, TRUSTED_SOURCES } from './provenance.js'
export { writeGate, contradicts, factKey } from './writeGate.js'
export { readGate, acl } from './readGate.js'
export { drift, embed, cosine, canonicalText } from './drift.js'
