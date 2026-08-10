# SSGM — Stability & Safety Governed Memory

A **training-free, browser-native** reference implementation of the SSGM framework from
**"Governing Evolving Memory in LLM Agents: Risks, Mechanisms, and the Stability and Safety
Governed Memory Framework"** (Lam, Li, Zhang & Zhao, [arXiv:2603.11768](https://arxiv.org/abs/2603.11768)).

SSGM is a **governance layer**, not a model. It decouples memory *evolution* from *execution* so that
an LLM agent's long-lived memory cannot silently corrupt itself. Zero training — pure deterministic
logic layered over an ordinary key/value store.

> 📖 **[Read the full write-up with screenshots →](docs/ARTICLE.md)**
> 🕹️ **Live demo:** open `index.html`, or `npm run serve` → http://localhost:5178

![overview](docs/screenshots/01-overview.png)

## What it does

| Mechanism | What it prevents | Formula |
|---|---|---|
| **Weibull decay** | stale memories lingering forever | `w(Δτ) = exp(−(Δτ/η)^κ)` |
| **Write Validation Gate** `𝒢_write` | hallucinations overwriting core facts | `ΔM ∧ M_core ⊧ ⊥ → reject` |
| **Read Filtering Gate** | leakage / prompt-injected memory reaching context | `ACL ∧ w≥θ_fresh ∧ prov` |
| **Semantic drift** `δ` | lossy re-summarization going unnoticed | `1 − sim(E(M_T), E(K_true))` |
| **Reconciliation & rollback** | unrecoverable degradation | replay immutable `K_ledger` |

The store is **dual-track**: a mutable active graph `M_t` for fast reasoning, bounded against an
append-only immutable episodic log `K_ledger` that serves as ground truth `K_true`.

## Quick start

```bash
node --test        # run the 13-test governance suite
npm run serve      # serve the interactive demo on :5178
```

Or use the engine directly:

```js
import { SSGMemory } from './src/ssgm/index.js'

const mem = new SSGMemory({ decay: { eta: 30, kappa: 1.2 }, thetaFresh: 0.15 })

// A protected core fact — the write gate will defend it.
mem.addCore({ subject: 'p:allergy', predicate: 'has', value: 'penicillin',
              text: 'Patient is allergic to penicillin', source: 'clinician' })

// A hallucinated contradiction is rejected before it consolidates:
mem.write({ subject: 'p:allergy', predicate: 'has', value: 'none',
            text: 'No known allergies', source: 'agent-summary' }).admitted   // → false

// Retrieval is filtered by access control, freshness and provenance:
mem.retrieve('allergy medication', 'doctor')   // → { admitted, rejected }

// Drift is measured against the ledger and repaired:
mem.corruptSummarize(t => t.split(' ').slice(0, 2).join(' '))   // lossy re-summarize
mem.driftScore()                                                // → > 0
mem.reconcile()                                                 // δ → 0, quarantines ungoverned units
mem.rollback(seq)                                              // rebuild M_t from the immutable log
```

## Layout

```
src/ssgm/         dependency-free ESM governance engine
  core.js         SSGMemory: dual-track store, reconcile, rollback
  decay.js        Weibull freshness w(Δτ)
  writeGate.js    𝒢_write — TMS contradiction check vs M_core
  readGate.js     ACL + freshness + provenance filtering
  provenance.js   trusted-source signatures σ(μ)
  drift.js        δ = 1 − sim(E(M_T), E(K_true))
index.html        interactive demo (also deployed via GitHub Pages)
app.js            demo wiring
test/             node --test governance suite
docs/             article + screenshots
```

## Conclusion

SSGM reframes agent memory safety as an **engineering-governance** problem, not a modelling one. This project shows the whole framework runs in a browser tab with no training, no model weights, and no dependencies, and that every safeguard — decay, the write/read gates, provenance, drift bounding, reconciliation and rollback — is independently tested and observable in the live demo. It's meant to be adopted incrementally, as a layer wrapped around an existing key/value memory store.

## Disclaimer

This repository is **my own interpretation** of the SSGM paper, built to understand it by implementing it. I have tried to stay as faithful as possible to the concepts, formulas, and architecture described by the authors. Where the paper is conceptual I made concrete engineering choices to make it runnable — e.g. a bag-of-terms projection instead of a learned embedding model for `E(·)`, an FNV keyed digest instead of real asymmetric cryptography for the provenance signature `σ(μ)`, and a lexical + structured contradiction check instead of a full NLI / Truth-Maintenance engine.

**All credit for the ideas and innovation goes to the authors of the paper — Chingkwun Lam, Jiaxin Li, Lingfei Zhang, and Kuo Zhao ([arXiv:2603.11768](https://arxiv.org/abs/2603.11768)).** Any errors or misreadings in this interpretation are entirely mine.

## License

MIT
