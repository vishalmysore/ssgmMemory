// Executable rules — ordinary functions that compute over typed user state and
// fire deterministically whenever the state changes. This is the paper's
// "proactive safety alerts by executing rules deterministically" — e.g.
// flagging a drug–allergy conflict automatically, which a retrieval system
// cannot do reliably because the check depends on the *whole* record at once.

// Small demonstrative clinical knowledge bases (a real deployment would load
// a drug database; the governance logic is identical).
const ALLERGY_DRUGS = {
  penicillin: ['amoxicillin', 'ampicillin', 'penicillin', 'augmentin'],
  sulfa: ['sulfamethoxazole', 'bactrim', 'sulfasalazine'],
  aspirin: ['aspirin', 'ibuprofen', 'naproxen'],
}

const DRUG_INTERACTIONS = [
  ['warfarin', 'ibuprofen', 'bleeding risk'],
  ['warfarin', 'aspirin', 'bleeding risk'],
  ['lisinopril', 'spironolactone', 'hyperkalemia risk'],
  ['metformin', 'alcohol', 'lactic acidosis risk'],
]

const DIET_CONFLICTS = {
  vegetarian: ['steak', 'bacon', 'chicken', 'beef', 'pork', 'ham'],
  vegan: ['steak', 'bacon', 'chicken', 'beef', 'pork', 'ham', 'cheese', 'milk', 'eggs', 'butter'],
  'low-sodium': ['chips', 'instant noodles', 'bacon', 'pretzels'],
}

const has = (arr, x) => arr.some((v) => v.toLowerCase() === x.toLowerCase())

/** Drug ⨯ allergy conflicts. */
export function ruleDrugAllergy(user) {
  const alerts = []
  for (const allergy of user.allergies) {
    const banned = ALLERGY_DRUGS[allergy.toLowerCase()] || [allergy.toLowerCase()]
    for (const med of user.medications) {
      if (banned.includes(med.name.toLowerCase())) {
        alerts.push({ level: 'critical', rule: 'drug_allergy',
          msg: `${med.name} is contraindicated — patient is allergic to ${allergy}.` })
      }
    }
  }
  return alerts
}

/** Drug ⨯ drug interactions. */
export function ruleDrugInteraction(user) {
  const names = user.medications.map((m) => m.name.toLowerCase())
  const alerts = []
  for (const [a, b, risk] of DRUG_INTERACTIONS) {
    if (names.includes(a) && names.includes(b)) {
      alerts.push({ level: 'warning', rule: 'drug_interaction',
        msg: `${a} + ${b} — ${risk}.` })
    }
  }
  return alerts
}

/** Spending vs declared budget (aggregates over the whole purchase history). */
export function ruleBudget(user) {
  const spent = {}
  for (const p of user.purchases) spent[p.category] = (spent[p.category] || 0) + p.amount
  const alerts = []
  for (const [cat, cap] of Object.entries(user.budgets)) {
    if ((spent[cat] || 0) > cap) {
      alerts.push({ level: 'warning', rule: 'budget',
        msg: `Over budget on ${cat}: $${spent[cat].toFixed(2)} spent vs $${cap.toFixed(2)} cap.` })
    }
  }
  return alerts
}

/** Purchases that conflict with a declared diet. */
export function ruleDiet(user) {
  const alerts = []
  for (const pref of user.diet) {
    const banned = DIET_CONFLICTS[pref.toLowerCase()] || []
    for (const p of user.purchases) {
      if (has(banned, p.item)) {
        alerts.push({ level: 'info', rule: 'diet',
          msg: `${p.item} conflicts with declared ${pref} diet.` })
      }
    }
  }
  return alerts
}

const RULES = [ruleDrugAllergy, ruleDrugInteraction, ruleBudget, ruleDiet]

/** Run every rule over the compiled user; returns fired alerts (most severe first). */
export function runRules(user) {
  const order = { critical: 0, warning: 1, info: 2 }
  const alerts = RULES.flatMap((r) => r(user))
  return alerts.sort((a, b) => order[a.level] - order[b.level])
}
