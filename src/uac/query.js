// Query answering — two strategies, side by side.
//
//  • uacAnswer()       executes a function over the TYPED, compiled user state.
//                      Aggregations (sum / count / dedup) are exact because the
//                      whole history is available as structured data.
//  • retrievalAnswer() the "bag of facts" baseline: keyword-match the raw fact
//                      log, take the Top-K, and answer from only those snippets.
//                      This is what RAG does — and why it fails at computation
//                      over many records (the paper: 6–43% vs ~99% for UaC).

const TOP_K = 3

function terms(q) {
  return q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
}

/** Classify the question into an executable intent. */
export function parseIntent(q) {
  const s = q.toLowerCase()
  if (/\b(spend|spent|total|how much)\b/.test(s)) {
    const cat = matchCategory(s)
    return { kind: 'sum_spend', category: cat }
  }
  if (/\b(how many|count|times|number of)\b/.test(s)) {
    return { kind: 'count_item', item: matchItem(s) }
  }
  if (/\b(medication|medicine|meds|taking|drugs?)\b/.test(s)) return { kind: 'current_meds' }
  if (/\ballerg/.test(s)) return { kind: 'allergies' }
  if (/\b(diet|vegetarian|vegan)\b/.test(s)) return { kind: 'diet' }
  return { kind: 'unknown' }
}

function matchCategory(s) {
  for (const c of ['coffee', 'groceries', 'dining', 'transport', 'shopping', 'entertainment'])
    if (s.includes(c)) return c
  return null
}
function matchItem(s) {
  const m = s.match(/\b(coffee|pizza|steak|chips|books?|latte|burger)\b/)
  return m ? m[1].replace(/s$/, '') : null
}

/** Execute the intent over typed state — exact. */
export function uacAnswer(user, q) {
  const intent = parseIntent(q)
  switch (intent.kind) {
    case 'sum_spend': {
      const rows = user.purchases.filter((p) => !intent.category || p.category === intent.category)
      const total = rows.reduce((a, p) => a + p.amount, 0)
      return { answer: `$${total.toFixed(2)}`, detail: `summed ${rows.length} purchase record(s)`, exact: true }
    }
    case 'count_item': {
      const n = user.purchases.filter((p) => !intent.item || p.item.toLowerCase().includes(intent.item)).length
      return { answer: `${n}`, detail: `counted over ${user.purchases.length} record(s)`, exact: true }
    }
    case 'current_meds': {
      const meds = user.medications.map((m) => `${m.name} ${m.dose}`.trim())
      return { answer: meds.length ? meds.join(', ') : '(none)', detail: 'deduplicated from log (stops applied)', exact: true }
    }
    case 'allergies':
      return { answer: user.allergies.join(', ') || '(none)', detail: 'typed field', exact: true }
    case 'diet':
      return { answer: user.diet.join(', ') || '(none)', detail: 'latest diet state', exact: true }
    default:
      return { answer: '(no executable intent)', detail: 'unknown query', exact: false }
  }
}

/**
 * Bag-of-facts retrieval baseline. Returns the Top-K matching raw facts and an
 * answer derived ONLY from those snippets — so sums/counts are truncated to K
 * and dedup/stop-events are missed. Deliberately faithful, not a strawman:
 * this is exactly RAG's failure mode on computation-over-history.
 */
export function retrievalAnswer(log, q) {
  const qt = terms(q)
  const scored = log
    .map((f) => ({ f, hits: qt.filter((t) => (f.text + ' ' + JSON.stringify(f.data)).toLowerCase().includes(t)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  const top = scored.slice(0, TOP_K).map((x) => x.f)
  const intent = parseIntent(q)

  let answer = '—'
  if (intent.kind === 'sum_spend') {
    const partial = top.filter((f) => f.kind === 'purchase').reduce((a, f) => a + (f.data.amount || 0), 0)
    answer = `~$${partial.toFixed(2)} (from ${top.length} retrieved snippets only)`
  } else if (intent.kind === 'count_item') {
    answer = `${top.filter((f) => f.kind === 'purchase').length} (only Top-${TOP_K} retrieved)`
  } else if (intent.kind === 'current_meds') {
    answer = top.filter((f) => f.kind === 'med_start').map((f) => f.data.name).join(', ') || '(unclear)'
  } else if (intent.kind === 'allergies') {
    answer = top.filter((f) => f.kind === 'allergy').map((f) => f.data.substance).join(', ') || '(unclear)'
  } else {
    answer = top.length ? top[0].text : '(no match)'
  }
  return { answer, snippets: top.map((f) => f.text || `${f.kind}:${JSON.stringify(f.data)}`), exact: false }
}
