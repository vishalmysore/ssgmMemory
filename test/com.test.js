import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ChainOfMemory, buildChain, naiveTopK, sim } from '../src/com/index.js'

// A multi-hop scenario: the query mentions "trip" and "heart/health"; the
// altitude facts are the BRIDGES that connect them but share no words with the
// query — so Top-K misses them and the chain must find them by connection.
function travelStore() {
  const com = new ChainOfMemory({ capacity: 12 })
  com.remember({ content: 'User is flying to Denver next week for a conference.', tags: ['trip', 'denver'], importance: 0.6 })
  com.remember({ content: 'Denver sits at 5280 feet — a high altitude city.', tags: ['denver', 'altitude'], importance: 0.5 })
  com.remember({ content: 'High altitude can worsen existing heart conditions.', tags: ['altitude', 'heart'], importance: 0.5 })
  com.remember({ content: 'User has a heart condition (arrhythmia) on record.', tags: ['heart', 'health'], importance: 0.7 })
  com.remember({ content: 'User enjoys skiing and snowboarding in winter.', tags: ['hobby'], importance: 0.3 })
  com.remember({ content: 'User prefers aisle seats on flights.', tags: ['pref'], importance: 0.3 })
  com.remember({ content: 'User drinks oat-milk lattes every morning.', tags: ['coffee'], importance: 0.3 })
  return com
}

test('chain assembles the multi-hop bridge that Top-K misses', () => {
  const com = travelStore()
  const units = com.store.all()
  const q = 'is my trip safe given my heart health?'

  const chain = buildChain(q, units)
  const path = chain.hops.map((h) => h.unit.content)

  // The chain should contain both altitude bridge facts.
  assert.ok(path.some((c) => /altitude city/.test(c)), 'chain includes the Denver-altitude bridge')
  assert.ok(path.some((c) => /worsen existing heart/.test(c)), 'chain includes the altitude-heart bridge')

  // Top-K by query similarity misses at least one bridge (they share no query terms).
  const naive = naiveTopK(q, units, { k: 3 }).map((n) => n.unit.content)
  const naiveMissesABridge =
    !naive.some((c) => /altitude city/.test(c)) || !naive.some((c) => /worsen existing heart/.test(c))
  assert.ok(naiveMissesABridge, 'naive Top-K fails to surface a bridge fragment')
})

test('query() reports bridge units present in the chain but absent from Top-K', () => {
  const com = travelStore()
  const res = com.query('is my trip safe given my heart health?', { k: 3 })
  assert.ok(res.bridges.length >= 1, 'at least one bridge is recovered only by the chain')
  assert.ok(res.chain.hops.length >= 3, 'chain forms a multi-hop pathway')
})

test('chain is an ordered pathway with connected hops', () => {
  const com = travelStore()
  const { hops } = buildChain('is my trip safe given my heart health?', com.store.all())
  // Every non-seed hop connects to the previous frontier with positive link strength.
  for (let i = 1; i < hops.length; i++) assert.ok(hops[i].link > 0, `hop ${i} connects to the frontier`)
})

test('adaptive truncation stops the chain when nothing connects strongly', () => {
  const com = new ChainOfMemory()
  com.remember({ content: 'The capital of France is Paris.', tags: ['geo'] })
  com.remember({ content: 'Photosynthesis converts sunlight into energy.', tags: ['bio'] })
  com.remember({ content: 'The stock market closed higher today.', tags: ['finance'] })
  const { hops, stoppedBy } = buildChain('tell me about Paris', com.store.all(), { threshold: 0.12 })
  assert.equal(hops.length, 1, 'no unrelated unit connects, so the chain is just the seed')
  assert.equal(stoppedBy, 'adaptive-truncation')
})

test('dynamic evolution reinforces traversed units', () => {
  const com = travelStore()
  const before = com.store.all().map((u) => u.access)
  com.query('is my trip safe given my heart health?')
  const after = com.store.all().map((u) => u.access)
  assert.ok(after.some((a, i) => a > before[i]), 'some units gained access count after a query')
})

test('adaptive truncation prunes the lowest-scoring units at capacity', () => {
  const com = new ChainOfMemory({ capacity: 3, halfLife: 20 })
  const keep = com.remember({ content: 'critical allergy note', importance: 0.9 })
  com.tick(1)
  com.remember({ content: 'trivia one', importance: 0.1 })
  com.remember({ content: 'trivia two', importance: 0.1 })
  com.remember({ content: 'trivia three', importance: 0.1 })
  com.remember({ content: 'trivia four', importance: 0.1 })
  const pruned = com.consolidate()
  assert.ok(pruned.length >= 1, 'over-capacity units are pruned')
  assert.ok(com.store.all().includes(keep), 'the high-importance unit is retained')
  assert.ok(com.store.all().length <= 3)
})

test('bag-of-terms similarity is symmetric and bounded', () => {
  assert.equal(sim('denver altitude', 'denver altitude'), 1)
  assert.equal(sim('denver', 'photosynthesis'), 0)
  const s = sim('high altitude heart', 'altitude worsens heart')
  assert.ok(s > 0 && s < 1)
})
