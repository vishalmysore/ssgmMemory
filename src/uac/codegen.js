// Code generation — render the compiled user as source. This is the visible
// artifact of the paper's paradigm: the user literally *is* a small typed
// program. The paper uses Python (typed objects + functions); we render both a
// Python view (faithful to the paper) and note that the live rules/queries in
// this demo execute the equivalent JavaScript in src/uac/rules.js & query.js.

function pyStr(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`
}

/** Render the typed user state as a Python dataclass instance (paper style). */
export function toPython(user) {
  const meds = user.medications.map((m) => `Med(name=${pyStr(m.name)}, dose=${pyStr(m.dose)})`).join(',\n        ')
  const purch = user.purchases
    .map((p) => `Purchase(item=${pyStr(p.item)}, category=${pyStr(p.category)}, amount=${p.amount}, t=${p.t})`)
    .join(',\n        ')
  const budgets = Object.entries(user.budgets).map(([k, v]) => `${pyStr(k)}: ${v}`).join(', ')

  return `@dataclass
class User:
    allergies: list[str] = field(default_factory=lambda: [
        ${user.allergies.map(pyStr).join(', ')}
    ])
    medications: list[Med] = field(default_factory=lambda: [
        ${meds}
    ])
    diet: list[str] = field(default_factory=lambda: [${user.diet.map(pyStr).join(', ')}])
    purchases: list[Purchase] = field(default_factory=lambda: [
        ${purch}
    ])
    budgets: dict[str, float] = field(default_factory=lambda: {${budgets}})

    # Executable rules run automatically on state change:
    def on_change(self) -> list[Alert]:
        return [*drug_allergy(self), *drug_interaction(self),
                *budget(self), *diet(self)]

    # Aggregations compute over the WHOLE history — exact, not retrieved:
    def total_spent(self, category=None) -> float:
        return sum(p.amount for p in self.purchases
                   if category is None or p.category == category)`
}
