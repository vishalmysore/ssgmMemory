// Chain-of-Memory interactive demo — wires the CoM engine to the DOM.
import { ChainOfMemory } from './src/com/index.js'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

let com
let lastQuery = 'is my trip safe given my heart health?'

// ── Seed scenario (multi-session assistant memory) ──────────────────────────
const SEED = [
  ['User is flying to Denver next week for a work conference.', 'trip denver flight', 0.6],
  ['Denver sits at 5280 feet — a notably high altitude city.', 'denver altitude elevation', 0.5],
  ['High altitude can worsen existing heart conditions.', 'altitude heart condition risk', 0.5],
  ['User has a heart condition (arrhythmia) on their medical record.', 'heart health arrhythmia medical', 0.7],
  ['User takes a beta-blocker every morning.', 'medication beta-blocker meds', 0.6],
  ['Beta-blockers can reduce tolerance to high altitude.', 'beta-blocker altitude tolerance', 0.5],
  ['User enjoys skiing and snowboarding in winter.', 'hobby skiing winter', 0.3],
  ['User prefers aisle seats on long flights.', 'preference aisle seat', 0.3],
  ['User drinks an oat-milk latte every morning.', 'coffee latte breakfast', 0.3],
  ['Denver weather in spring is dry and sunny.', 'denver weather spring sunny', 0.4],
]

function seed() {
  com = new ChainOfMemory({ capacity: Number($('capacity').value), halfLife: 40 })
  for (const [content, tags, importance] of SEED) {
    com.remember({ content, tags: tags.split(' '), importance })
    com.tick(1)
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderStore(pruned = []) {
  const now = com.store.clock
  const maxScore = Math.max(0.001, ...com.store.all().map((u) => com.store.score(u, now)))
  const rows = [...com.store.all(), ...pruned].map((u) => {
    const s = com.store.score(u, now)
    const isPruned = pruned.includes(u)
    return `<div class="mem-unit ${isPruned ? 'pruned' : ''}">
      <div class="content">${esc(u.content)}<div class="tags">${u.tags.map((t) => '#' + esc(t)).join(' ')}</div></div>
      <div>
        <div class="metrics"><span>imp <b>${u.importance.toFixed(2)}</b></span><span>acc <b>${u.access}</b></span><span>score <b>${s.toFixed(2)}</b></span></div>
        <div class="sbar"><div style="width:${Math.round((s / maxScore) * 100)}%"></div></div>
      </div>
    </div>`
  })
  $('storeBody').innerHTML = rows.join('')
  $('count').textContent = com.store.all().length
  $('cap').textContent = com.store.capacity
  $('clock').textContent = com.store.clock
}

function renderQuery(q) {
  lastQuery = q
  const res = com.query(q, { k: 3, maxHops: 5, threshold: 0.12, evolve: true })
  const bridgeIds = new Set(res.bridges.map((u) => u.id))

  // Chain pathway (ordered)
  const parts = []
  res.chain.hops.forEach((h, i) => {
    const role = i === 0 ? 'seed' : bridgeIds.has(h.unit.id) ? 'bridge' : 'hop'
    if (i > 0) {
      parts.push(`<div class="chain-connector"><span class="arrow">↓</span> connects at link ${h.link.toFixed(2)} · goal ${h.goal.toFixed(2)}</div>`)
    }
    parts.push(`<div class="chain-hop ${role}">
      <div class="role">${role === 'seed' ? 'SEED · most query-relevant' : role === 'bridge' ? 'BRIDGE · missed by Top-K' : 'HOP'}</div>
      ${esc(h.unit.content)}
    </div>`)
  })
  $('chainPath').innerHTML = parts.join('') || '<div class="hint">no units</div>'

  // Naive bag (unordered)
  $('naiveBag').innerHTML = res.naive.length
    ? res.naive.map((n) => `<div class="chip">${esc(n.unit.content)}<div class="s">sim ${n.sim.toFixed(2)}</div></div>`).join('')
    : '<div class="hint">no matches</div>'

  $('bridgeN').textContent = res.bridges.length
  $('hopN').textContent = res.chain.hops.length
  $('stopBy').textContent = res.chain.stoppedBy === 'adaptive-truncation' ? 'adaptive-truncation' : 'max hops'
  renderStore()
}

// ── Events ───────────────────────────────────────────────────────────────────
$('queryForm').addEventListener('submit', (ev) => { ev.preventDefault(); com.tick(1); renderQuery(new FormData(ev.target).get('q')) })
for (const btn of document.querySelectorAll('[data-q]')) {
  btn.onclick = () => { $('queryForm').elements.q.value = btn.dataset.q; com.tick(1); renderQuery(btn.dataset.q) }
}

$('addForm').addEventListener('submit', (ev) => {
  ev.preventDefault()
  const f = new FormData(ev.target)
  const content = f.get('content')
  if (!content || !content.trim()) return
  com.tick(1)
  com.remember({ content: content.trim(), tags: String(f.get('tags') || '').split(/\s+/).filter(Boolean), importance: 0.5 })
  ev.target.reset(); renderStore()
})

$('consolidate').onclick = () => { const pruned = com.consolidate(); renderStore(pruned) }
$('capacity').oninput = () => { $('capVal').textContent = $('capacity').value; if (com) com.store.capacity = Number($('capacity').value); renderStore() }
$('reset').onclick = () => { seed(); renderStore(); $('chainPath').innerHTML = ''; $('naiveBag').innerHTML = ''; $('bridgeN').textContent = '0'; $('hopN').textContent = '0'; $('stopBy').textContent = '—' }

// ── Scenario mode for screenshots: ?demo=chain | truncate ────────────────────
function runScenario(name) {
  if (name === 'chain') renderQuery(lastQuery)
  else if (name === 'truncate') {
    com.store.capacity = 6
    $('capacity').value = 6; $('capVal').textContent = '6'; $('cap').textContent = '6'
    renderQuery(lastQuery)
    const pruned = com.consolidate(); renderStore(pruned)
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
seed()
renderStore()
const demo = new URLSearchParams(location.search).get('demo')
if (demo) runScenario(demo)
window.__com = () => com
