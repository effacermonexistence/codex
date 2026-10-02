# Routing architecture — RCC policy v54 and the owner contract (2026-10-02)

Owner objective (2026-10-02): whatever OS-1 is asked — a build or a small task — the result must feel like
Claude Code's newest model at its strongest reasoning (or OpenAI's best at its strongest), with fewer tokens
through RCC/REVAS, and keep improving from measured outcomes. "자고 일어나면 … 클로드 코드 같아야 돼."

## What was wrong (measured, not inferred)

Replaying the deployed v53 policy over the owner's 316 recorded prompts sent 288 to Codex, 12 to Claude (all
named) and 16 to the local exact lane — **identically at Codex 30 / Claude 100, 100 / 100 and 100 / 30**. The
conversation's capacity mix, the owner's own provider choice since 2026-08-31 (#9: "spends each backend
according to task fit and weekly capacity") and re-ordered on 2026-09-25 (v43: "아직 클로드로 라우팅 안되는것
같은데 고쳐"), had no effect. A domain-naming conversation ran all 13 turns on the Codex agent (Astra high/max,
6.1 Sol ultra), 29–346 s each; the Codex weekly window stood at 76 % used.

Causes, in the order they decided routes:

1. v50 let a route with an evaluation record (ten tasks, LLM-judged) replace every other candidate whenever
   Codex had any capacity, and v52 did the same for changes. The mix stopped mattering.
2. v43 priced the mix into the money term only, so a faster time prior still outran a 30 % mix.
3. Inside a provider any model within the benchmark noise was admitted (Sonnet 5.5 stood in for Opus 5.5,
   learning from five-token routing probes); across providers a route outside the noise of the best of both was
   dropped, against the owner's two-reference objective.
4. Naming both backends, or asking about one ("…클로드랑 코덱스한테?", "왜 코덱스한테만 넘기냐?"), pinned a route.
5. A route failing most of its runs could still look cheapest.

A client-side divergence compounded it: every write-scope turn carried the website and preview delivery cards
(~3.5 KB). The owner's question "일단은 글로벌해야 되고 대기업 웹페이지 문법을 따라야 되는데?" made Claude Opus build a
web page with headless Chrome for fifteen minutes. The cards now go only to website work
(`WebsiteDelivery.relevant`, fixture `WebsiteDeliveryRelevanceFixture`).

## The architecture, as clauses the policy must keep

The private policy's self-test now carries an **owner contract** — each clause an owner order, checked with the
owner's own prompts under an empty and a live-shaped ledger. A policy that breaks a clause fails its self-test
and cannot be bundled (`products/os1-private-route-core/scripts/build-policy-rollover.mjs` runs it).

1. **The capacity mix chooses the provider.** A clearly larger share names the provider automatic routing uses;
   only that provider's measured failure on the task class, no admitted route on it, or the evaluator's retry
   hint moves work off it. A closer mix prices each provider's quota; an even mix lets the measurements decide.
2. **Domain and conversation questions** run on Claude's best model at its strongest setting at the default mix.
3. **Best model only:** each provider's best registered model when it is in the inventory, at the reference
   effort; never a lower tier standing in for it; no silent downgrade when it is missing.
4. **A named backend wins**, and so does the client's quota-window burn (an explicit Codex preference).
5. **Mentions are not directions:** naming both backends, or a backend inside a question, does not pin.
6. **Measured failure moves work**; speed or price alone does not override the owner's mix.
7. **Ultra only when asked** at the default mix.
8. **Arithmetic stays local.**

Evaluation records still choose a provider's representative route (Codex answers: Astra; Codex changes:
GPT-6.1 Sol ultra) — they no longer remove the other provider.

## Result

| ledger | mix (Codex / Claude) | v53 | v54 |
|---|---|---|---|
| empty | 30 / 100 | Codex 288 · Claude 12 | Claude 285 · Codex 15 (named) · local 16 |
| empty | 100 / 100 | same | Claude 207 · Codex 93 |
| empty | 100 / 30 | same | Codex 295 · Claude 5 (named) |
| live-shaped | 30 / 100 | same | Claude 285 · Codex 15 (named) |

Live after the pin (2026-10-02 16:36Z): `1+1` → local exact, adopted; the owner's domain question at the default
mix → `claude-opus-5-5` · max (it was `gpt-6-astra`).

## Rollback

Route core: `wrangler rollback --version-id f9c1d6af-a4ad-4a23-b231-22de21913484` in
`products/os1-private-route-core` (v53 pin; the v54 policy worker still serves v53 byte-identically for routes
started under it). The client changes are independent of the policy version.
