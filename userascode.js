// User-as-Code interactive demo — wires the UaC engine to the DOM.
import { UaCMemory } from './src/uac/index.js'
import { runRules } from './src/uac/rules.js'
import { uacAnswer, retrievalAnswer } from './src/uac/query.js'
import { toPython } from './src/uac/codegen.js'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

let m

// ── Preset observations ─────────────────────────────────────────────────────
const FACTS = {
  allergy: ['allergy', { substance: 'penicillin' }, 'user: "I\'m allergic to penicillin"'],
  amoxicillin: ['med_start', { name: 'amoxicillin', dose: '500mg' }, 'user: "started amoxicillin 500mg"'],
  warfarin: ['med_start', { name: 'warfarin', dose: '5mg' }, 'user: "started warfarin 5mg"'],
  ibuprofen: ['med_start', { name: 'ibuprofen', dose: '200mg' }, 'user: "took some ibuprofen"'],
  coffee: ['purchase', { item: 'coffee', category: 'coffee', amount: 4.5 }, 'user: "bought a coffee, $4.50"'],
  budget: ['budget_set', { category: 'coffee', amount: 20 }, 'user: "keep me under $20/mo on coffee"'],
  veg: ['diet_set', { pref: 'vegetarian' }, 'user: "I\'m going vegetarian"'],
  steak: ['purchase', { item: 'steak', category: 'dining', amount: 32 }, 'user: "had a steak dinner, $32"'],
}

// ── Lightweight free-text parsing (presets carry structured data) ────────────
function parseUtterance(s) {
  const t = s.toLowerCase().trim()
  let mt
  if ((mt = t.match(/allerg\w*\s+(?:to\s+)?(\w+)/))) return ['allergy', { substance: mt[1] }, `user: "${s}"`]
  if ((mt = t.match(/(?:start|started|take|taking)\s+([a-z]+)\s*(\d+\s*mg)?/))) return ['med_start', { name: mt[1], dose: mt[2] || '' }, `user: "${s}"`]
  if ((mt = t.match(/stop\s+([a-z]+)/))) return ['med_stop', { name: mt[1] }, `user: "${s}"`]
  if ((mt = t.match(/(?:bought|buy|purchased|spent).*?([a-z]+).*?\$?\s*(\d+(?:\.\d+)?)/))) {
    const item = mt[1]
    return ['purchase', { item, category: item, amount: parseFloat(mt[2]) }, `user: "${s}"`]
  }
  if ((mt = t.match(/budget.*?([a-z]+).*?\$?\s*(\d+)/))) return ['budget_set', { category: mt[1], amount: parseFloat(mt[2]) }, `user: "${s}"`]
  if (/vegetarian/.test(t)) return ['diet_set', { pref: 'vegetarian' }, `user: "${s}"`]
  if (/vegan/.test(t)) return ['diet_set', { pref: 'vegan' }, `user: "${s}"`]
  return null
}

// ── Seed scenario ────────────────────────────────────────────────────────────
function seed() {
  m = new UaCMemory()
  const order = ['allergy', 'coffee', 'coffee', 'veg', 'warfarin', 'coffee', 'budget', 'coffee', 'coffee']
  for (const k of order) {
    const [kind, data, text] = FACTS[k]
    m.append(kind, { ...data }, text)
    m.tick(1)
  }
  m.checkpoint()
}

// ── Rendering ────────────────────────────────────────────────────────────────
function highlight(src) {
  // Use bare, attribute-free tags so no regex can match markup a prior step
  // injected (strings first, so later keyword/name matches can't hit them).
  return esc(src)
    .replace(/"[^"]*"/g, '<em>$&</em>') // strings
    .replace(/(#[^\n]*)/g, '<i>$1</i>') // comments
    .replace(/\b(drug_allergy|drug_interaction|budget|diet|total_spent|on_change)(?=\()/g, '<u>$1</u>')
    .replace(/\b(class|def|return|list|dict|float|str|int|lambda|field)\b/g, '<b>$1</b>')
}

function renderLog() {
  const rows = m.log.map((f, i) => {
    const pending = i >= m.lastCheckpointSeq
    return `<tr class="${pending ? 'pendingrow' : ''}"><td>${f.t}</td><td class="kind">${f.kind}</td><td>${esc(f.text || JSON.stringify(f.data))}</td></tr>`
  }).reverse()
  $('logBody').innerHTML = rows.join('')
  $('pending').textContent = m.pending()
  $('clock').textContent = m.clock
}

function renderCode() {
  $('codeView').innerHTML = highlight(toPython(m.user))
}

function renderAlerts() {
  const alerts = runRules(m.user)
  $('alertList').innerHTML = alerts.length
    ? alerts.map((a) => `<li class="${a.level}"><span class="lv">${a.level}</span>${esc(a.msg)}</li>`).join('')
    : '<li class="none">✓ No rules firing on the current compiled state.</li>'
}

function renderAll() {
  renderLog(); renderCode(); renderAlerts()
}

function runQuery(q) {
  const u = uacAnswer(m.user, q)
  $('uacAns').textContent = u.answer
  $('uacMeta').textContent = u.detail
  const r = retrievalAnswer(m.log, q)
  $('ragAns').textContent = r.answer
  $('ragSnips').innerHTML = r.snippets.length ? r.snippets.map((s) => `<li>${esc(s)}</li>`).join('') : '<li>(no matching snippets)</li>'
}

// ── Events ───────────────────────────────────────────────────────────────────
$('factForm').addEventListener('submit', (ev) => {
  ev.preventDefault()
  const s = new FormData(ev.target).get('utterance')
  if (!s || !s.trim()) return
  const parsed = parseUtterance(s)
  if (!parsed) { ev.target.reset(); return }
  m.tick(1); m.append(parsed[0], parsed[1], parsed[2]); ev.target.reset(); renderLog()
})

for (const btn of document.querySelectorAll('[data-fact]')) {
  btn.onclick = () => {
    const [kind, data, text] = FACTS[btn.dataset.fact]
    m.tick(1); m.append(kind, { ...data }, text); renderLog()
  }
}

$('checkpoint').onclick = () => { m.checkpoint(); renderAll() }
$('reset').onclick = () => { seed(); renderAll(); $('uacAns').textContent = '—'; $('uacMeta').textContent = ''; $('ragAns').textContent = '—'; $('ragSnips').innerHTML = '' }

$('queryForm').addEventListener('submit', (ev) => { ev.preventDefault(); runQuery(new FormData(ev.target).get('q')) })
for (const btn of document.querySelectorAll('[data-q]')) {
  btn.onclick = () => { $('queryForm').elements.q.value = btn.dataset.q; runQuery(btn.dataset.q) }
}

// ── Scenario mode for screenshots: ?demo=alert | query ───────────────────────
function runScenario(name) {
  if (name === 'alert') {
    // Append a conflicting drug then checkpoint so the safety rule fires.
    const [k, d, t] = FACTS.amoxicillin
    m.tick(1); m.append(k, { ...d }, t); m.checkpoint(); renderAll()
  } else if (name === 'query') {
    runQuery('how much did I spend on coffee?')
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
seed()
renderAll()
const demo = new URLSearchParams(location.search).get('demo')
if (demo) runScenario(demo)
window.__uac = () => m
