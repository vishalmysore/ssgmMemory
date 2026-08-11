import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  UaCMemory,
  compile,
  runRules,
  ruleDrugAllergy,
  uacAnswer,
  retrievalAnswer,
  parseIntent,
  toPython,
} from '../src/uac/index.js'

// ── Two-phase pipeline: capture then compile ───────────────────────────────

test('append never discards; checkpoint compiles the whole log into typed state', () => {
  const m = new UaCMemory()
  m.append('allergy', { substance: 'penicillin' }, 'allergic to penicillin')
  m.append('med_start', { name: 'lisinopril', dose: '10mg' }, 'started lisinopril 10mg')
  m.append('purchase', { item: 'coffee', category: 'coffee', amount: 4.5 }, 'bought coffee $4.50')
  assert.equal(m.log.length, 3)
  assert.equal(m.pending(), 3)

  const u = m.checkpoint()
  assert.equal(m.pending(), 0)
  assert.deepEqual(u.allergies, ['penicillin'])
  assert.equal(u.medications[0].name, 'lisinopril')
  assert.equal(u.purchases.length, 1)
})

test('compile resolves contradictions in code (later facts win; stops applied)', () => {
  const log = [
    { kind: 'diet_set', data: { pref: 'vegetarian' }, t: 1, text: '' },
    { kind: 'med_start', data: { name: 'warfarin', dose: '5mg' }, t: 2, text: '' },
    { kind: 'med_stop', data: { name: 'warfarin' }, t: 5, text: '' },
    { kind: 'diet_set', data: { pref: 'none' }, t: 6, text: '' },
  ]
  const u = compile(log)
  assert.deepEqual(u.diet, []) // 'none' cleared the vegetarian claim
  assert.equal(u.medications.length, 0) // warfarin was stopped
})

// ── Executable rules (deterministic safety) ────────────────────────────────

test('drug–allergy rule fires deterministically', () => {
  const u = compile([
    { kind: 'allergy', data: { substance: 'penicillin' }, t: 1, text: '' },
    { kind: 'med_start', data: { name: 'amoxicillin', dose: '500mg' }, t: 2, text: '' },
  ])
  const alerts = ruleDrugAllergy(u)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].level, 'critical')
  assert.match(alerts[0].msg, /amoxicillin/)
})

test('runRules aggregates budget + interaction + diet, most severe first', () => {
  const u = compile([
    { kind: 'allergy', data: { substance: 'penicillin' }, t: 1, text: '' },
    { kind: 'med_start', data: { name: 'amoxicillin', dose: '500mg' }, t: 2, text: '' },
    { kind: 'med_start', data: { name: 'warfarin', dose: '5mg' }, t: 3, text: '' },
    { kind: 'med_start', data: { name: 'ibuprofen', dose: '200mg' }, t: 4, text: '' },
    { kind: 'budget_set', data: { category: 'coffee', amount: 20 }, t: 5, text: '' },
    { kind: 'purchase', data: { item: 'coffee', category: 'coffee', amount: 25 }, t: 6, text: '' },
    { kind: 'diet_set', data: { pref: 'vegetarian' }, t: 7, text: '' },
    { kind: 'purchase', data: { item: 'steak', category: 'dining', amount: 30 }, t: 8, text: '' },
  ])
  const alerts = runRules(u)
  assert.equal(alerts[0].level, 'critical') // drug-allergy sorts first
  assert.ok(alerts.some((a) => a.rule === 'drug_interaction'))
  assert.ok(alerts.some((a) => a.rule === 'budget'))
  assert.ok(alerts.some((a) => a.rule === 'diet'))
})

// ── Aggregation: UaC exact vs retrieval truncated ──────────────────────────

test('UaC computes an exact total; retrieval truncates to Top-K', () => {
  const m = new UaCMemory()
  const amounts = [4.5, 5.0, 3.75, 4.25, 6.0] // five coffees
  for (const a of amounts) m.append('purchase', { item: 'coffee', category: 'coffee', amount: a }, `bought coffee $${a}`)
  m.checkpoint()

  const exact = uacAnswer(m.user, 'how much did I spend on coffee?')
  assert.equal(exact.answer, '$23.50') // sum of all five
  assert.equal(exact.exact, true)

  const rag = retrievalAnswer(m.log, 'how much did I spend on coffee?')
  assert.equal(rag.exact, false)
  assert.ok(rag.snippets.length <= 3, 'retrieval only sees Top-K snippets')
  assert.ok(!rag.answer.includes('23.50'), 'retrieval cannot reach the true total')
})

test('count aggregation is exact under UaC', () => {
  const m = new UaCMemory()
  for (let i = 0; i < 7; i++) m.append('purchase', { item: 'pizza', category: 'dining', amount: 12 }, 'ordered pizza')
  m.checkpoint()
  assert.equal(uacAnswer(m.user, 'how many times did I order pizza?').answer, '7')
})

test('intent parser routes questions to executable functions', () => {
  assert.equal(parseIntent('how much did I spend on coffee').kind, 'sum_spend')
  assert.equal(parseIntent('how many times did I buy pizza').kind, 'count_item')
  assert.equal(parseIntent('what meds am I taking').kind, 'current_meds')
  assert.equal(parseIntent('what am I allergic to').kind, 'allergies')
})

// ── Codegen ────────────────────────────────────────────────────────────────

test('toPython renders the compiled user as a typed dataclass', () => {
  const u = compile([
    { kind: 'allergy', data: { substance: 'penicillin' }, t: 1, text: '' },
    { kind: 'med_start', data: { name: 'lisinopril', dose: '10mg' }, t: 2, text: '' },
  ])
  const src = toPython(u)
  assert.match(src, /class User:/)
  assert.match(src, /Med\(name="lisinopril", dose="10mg"\)/)
  assert.match(src, /def total_spent/)
})
