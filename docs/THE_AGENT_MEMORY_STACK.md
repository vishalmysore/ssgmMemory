# The Agent-Memory Stack: three papers, one lifecycle for how an AI agent should remember

*Training-free, browser-native reference implementations of three recent LLM-agent memory papers — [SSGM](ARTICLE.md), [User as Code](USER_AS_CODE.md), and [Chain-of-Memory](CHAIN_OF_MEMORY.md) — built as three tabs of one site, with no model, no build step, and no dependencies.*

---

## Why agent memory is suddenly a hard problem

A chatbot that answers one question and forgets is easy. An **agent** that runs for weeks — remembering you, updating what it knows, acting on it — is not. The moment memory becomes long-lived and self-editing, three different things start to go wrong, and they're usually treated as unrelated:

1. **The memory rots.** Every time the agent re-summarizes old notes, a little detail is lost — a photocopy of a photocopy. Contradictions pile up; a hallucination can overwrite a known fact; a private detail gets baked in forever.
2. **The memory can't compute.** A pile of retrieved text snippets can recall *"you bought coffee"* but can't reliably answer *"how much did I spend on coffee this month?"* — that needs a sum over the **whole** history, not the three snippets that matched.
3. **The memory doesn't connect.** Multi-hop questions need a *path* through several facts. Grabbing the top-K most similar snippets misses the bridge facts whose words don't match the question — so the reasoning breaks before it starts.

Three recent papers each take on one of these — and, read together, they describe a single **lifecycle**: how memory should be *governed*, *represented*, and *read back*. This repo implements all three as playable, training-free demos so you can see each mechanism work.

> **The common thread:** none of these need a bigger model. Each is a few hundred lines of deterministic logic layered over an ordinary store. That's the whole point — most "agent memory" problems are **engineering** problems, not capability problems. Every demo here runs entirely in a browser tab with no WebGPU, no download, no dependencies, and the same code runs under `node --test`.

---

## The three layers

```
                    ┌──────────────────────────────────────────────┐
   user / agent ──▶ │  ①  SSGM — GOVERN how memory changes         │
   observations     │      write gate · decay · provenance ·        │
                    │      drift bound · immutable ledger · rollback │
                    └───────────────────────┬──────────────────────┘
                                            │ a clean, trustworthy log
                                            ▼
                    ┌──────────────────────────────────────────────┐
                    │  ②  User as Code — REPRESENT what memory is   │
                    │      compile the log into typed state +        │
                    │      executable rules (a program, not a pile)  │
                    └───────────────────────┬──────────────────────┘
                                            │ structured, computable state
                                            ▼
                    ┌──────────────────────────────────────────────┐
                    │  ③  Chain-of-Memory — READ memory back        │
                    │      link fragments into an ordered multi-hop  │
                    │      reasoning chain (not a Top-K dump)         │
                    └───────────────────────┬──────────────────────┘
                                            ▼
                                    answer / action
```

Ingest → represent → retrieve → reason. Each paper owns one hand-off.

---

## ① SSGM — govern *how* memory changes

**"Governing Evolving Memory in LLM Agents"** (Lam, Li, Zhang & Zhao, [arXiv:2603.11768](https://arxiv.org/abs/2603.11768)) treats memory safety as **governance**: gates around the store, not a smarter model inside it.

![SSGM demo](screenshots/01-overview.png)

- **Write Validation Gate** — a proposed memory is admitted only if it doesn't contradict a protected core fact (`ΔM ∧ M_core ⊧ ⊥ → reject`). A hallucinated *"no known allergies"* is rejected against a locked penicillin-allergy fact.
- **Weibull decay** — freshness `w(Δτ)=exp(−(Δτ/η)^κ)` expires stale memories; retrieval reinforces what's used; core facts never decay.
- **Read Filtering Gate** — access control + freshness + a trusted **provenance** signature, so a prompt-injected memory is caught on the way out.
- **Semantic drift** `δ = 1 − sim(E(M_T), E(K_true))` is measured against an **immutable ledger**; **reconciliation** repairs the mutable graph and **rollback** rebuilds it from the log.

> Full write-up: **[Governing an agent's memory before it corrupts itself →](ARTICLE.md)**

---

## ② User as Code — change *what* memory is

**"User as Code: Executable Memory for Personalized Agents"** (Bojie Li, [arXiv:2606.16707](https://arxiv.org/abs/2606.16707)) stops storing the user as a bag of facts and starts storing them as a **typed program**: objects hold state, functions encode rules.

![User as Code — execute vs retrieve](screenshots/uac-03-query-vs-retrieval.png)

- **Two-phase pipeline** — an append-only fact log is periodically **compiled** into a typed `User` object (deduped, contradictions resolved in code).
- **Executable rules** fire deterministically on change — a drug–allergy conflict is flagged automatically, a check retrieval can't reliably make.
- **Aggregation is exact.** Ask *"how much did I spend on coffee?"* and UaC runs `sum()` over every record → **$22.50**, while bag-of-facts retrieval sees only its Top-3 snippets and guesses **~$13.50**. The paper's headline: **~99%** vs **6–43%** on computation-over-history.

> Full write-up: **[The user isn't a pile of facts — the user is a program →](USER_AS_CODE.md)**

---

## ③ Chain-of-Memory — change *how you read* memory back

**"Chain-of-Memory: Lightweight Memory Construction with Dynamic Evolution"** (Xu, Xu, Tian, Huang, Chen, Li & Shen, [arXiv:2601.14287](https://arxiv.org/abs/2601.14287)) keeps construction cheap and puts the intelligence in **utilization**: link retrieved fragments into a reasoning chain.

![Chain-of-Memory — chain vs Top-K](screenshots/com-01-chain-vs-topk.png)

- **Chain, not dump.** Seed at the most query-relevant unit, then hop by *connection strength* (`0.7·sim(frontier,·) + 0.3·sim(query,·)`), assembling an ordered path — and recovering the **bridge** facts (*"Denver is at 5,280 ft"*) that a query-only Top-K silently drops.
- **Dynamic evolution** reinforces the units a chain traverses; **adaptive truncation** prunes the lowest `importance × recency × log(access)` at capacity, keeping memory bounded.
- Reported: **7.5–10.4%** accuracy gains at ≈ **2.7%** of the tokens and **6.0%** of the latency of heavy graph memory.

> Full write-up: **[Don't dump the top matches — walk a chain →](CHAIN_OF_MEMORY.md)**

---

## Seen side by side

| | **SSGM** | **User as Code** | **Chain-of-Memory** |
|---|---|---|---|
| **Paper** | 2603.11768 | 2606.16707 | 2601.14287 |
| **Owns** | how memory *changes* | what memory *is* | how memory is *read* |
| **Core move** | gates + immutable ledger | compile log → typed program | link fragments into a chain |
| **Kills** | drift, hallucination, leakage | can't-compute, contradictions | broken multi-hop retrieval |
| **Signature demo** | reject a hallucination; reconcile drift | exact `$22.50` vs `~$13.50` | recover the bridge Top-K misses |
| **Engine** | [`src/ssgm/`](../src/ssgm/) | [`src/uac/`](../src/uac/) | [`src/com/`](../src/com/) |

They compose cleanly: SSGM produces a **clean, trustworthy log**; User as Code **compiles** that log into computable typed state; Chain-of-Memory **traverses** it as a reasoning path. Govern it, structure it, walk it.

---

## Run all three

```bash
node --test        # 28 tests across all three engines
npm run serve      # http://localhost:5178  →  / · /userascode.html · /chainofmemory.html
```

Live demos: **[SSGM](https://vishalmysore.github.io/ssgmMemory/)** · **[User as Code](https://vishalmysore.github.io/ssgmMemory/userascode.html)** · **[Chain-of-Memory](https://vishalmysore.github.io/ssgmMemory/chainofmemory.html)** · repo: **[github.com/vishalmysore/ssgmMemory](https://github.com/vishalmysore/ssgmMemory)**.

## Disclaimer

These are **my own interpretations** of three papers, built to understand them by implementing them. I've tried to stay faithful to each paper's concepts and architecture, but where they are conceptual I made concrete engineering choices to make them runnable and training-free — notably bag-of-terms similarity in place of learned embeddings, lightweight lexical checks in place of full NLI, and JavaScript in place of Python for the executable-memory rendering. **All credit for the ideas and innovation belongs to the original authors** — Chingkwun Lam, Jiaxin Li, Lingfei Zhang & Kuo Zhao (SSGM); Bojie Li (User as Code); and Xiucheng Xu, Bingbing Xu, Xueyun Tian, Zihe Huang, Rongxin Chen, Yunfan Li & Huawei Shen (Chain-of-Memory). Any errors of interpretation are mine; where this repo and a paper disagree, trust the paper.
