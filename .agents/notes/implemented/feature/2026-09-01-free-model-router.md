# Agent Note: Free-tier model routing with rate-limit and quota failover

Status: implemented

## Problem

The harness targets a single `agent-default-model`. `llm-retry` recovers a
failed request only by retrying the *same* provider route, and `QUOTA` is not
even retryable. There is no multi-key rotation and no cross-provider failover,
so a user on free API tiers stalls the moment one key hits its per-minute rate
limit or spends its daily allowance — which a coding task, making dozens to
hundreds of model calls, does quickly. Free tiers across platforms (Google AI
Studio, OpenRouter `:free`, Groq, Cerebras, Ollama) are individually usable but
only collectively sufficient, and nothing in the harness spreads load across
them.

## Decision

A new host package `@ibrahimsaleem/dsh-llm-free-model-router` owns
`ctx.modelRouter`: a shipped catalog of free platforms, a candidate pool
(`route × model × key`), and a health/quota ledger persisted to
`~/.dsh/free-model-router/ledger.json` (durable fields only — cooldown and
daily-quota state — so a spent tier is remembered across a restart; the rolling
per-minute counters are in memory).

Activating a platform (Settings ▸ Free Model Router, or a hand edit) writes its
key(s) to `ctx.credentials` and one hand-declared `llm-pi-ai.providers.free-<platform>`
route per key — every route OpenAI-compatible, so one adapter family covers
every platform and replay-envelope serialization stays consistent across a
switch.

Two agent-loop waterfall listeners, registered in the service constructor:

- **`agent/request`** (runs outermost — the router mounts at boot, before the
  per-agent `installModelSelection` listener, and reads the picker's resolved
  choice through `next()`): when the resolved model is a router candidate and
  the user has not hand-picked one this session, substitute the best healthy
  candidate; otherwise pass through untouched.
- **`agent/request-error`**: classify the failure — `classifyRateLimit` splits
  per-minute from daily on the flattened provider message plus `Retry-After` /
  Google `retryDelay` / OpenRouter `X-RateLimit-Reset` — cool (`Retry-After` or
  60 s) or long-cool (parsed reset or the platform's next daily reset) or
  disable (`AUTH`) the candidate, write a `router/switch` session event, and
  return `{ kind: 'retry' }` when another healthy candidate exists. When every
  candidate is cooling: a bounded wait (≤ 45 s) for the soonest reset, then
  local Ollama, then a terminal failure. The per-step switch budget
  (`pool.length + 2`) is reconstructed crash-safe from the `router/switch`
  events, mirroring `llm-retry`'s reconstruction of `llm/retry`.

Router routes declare `retryPolicy.retryableCodes` without `RATE_LIMIT`, so
`llm-retry` delegates rate limits and quota errors to this listener regardless
of waterfall order, and still gives a transient `SERVER` / `TIMEOUT` a fast
same-route retry first.

Failure classification is entirely router-side (`classify.ts`), reading the
existing `LlmFailure`; the only adapter change is a one-line addition to
`classifyPiAiError` so non-router consumers also get the right coarse code for
Google `RESOURCE_EXHAUSTED`.

A `router.*` apiproxy domain (loopback-only, thin pass-through to
`ctx.modelRouter`) and a `settings.section` client panel
(`@ibrahimsaleem/dsh-client-ui-free-model-router`) drive activation and show
per-candidate health. Pool policy is a user setting with three modes —
`balanced` (default, thinking off, mid-turn switch only on a hard limit),
`max-quality` (top model incl. reasoning, switch freely), `max-stability`
(non-reasoning only, switch between turns).

## Consequences

- With `enabled: true` and at least one platform active, a session starts on the
  top-ranked healthy free model with no manual selection; the model picker still
  wins as an explicit per-session override.
- The router keeps `agent-default-model` pointed at its current top healthy pick
  via a heavily debounced `saveSelection`, only when the current default
  candidate is disabled or long-cooling, never over a same-session manual pick.
- `request/context` still reflects the real route on every switch, so
  `token-meter` and `harness-monitor` stay accurate.
- New durable session events `router/switch` and `router/candidate-disabled`
  join `KNOWN_SESSION_EVENT_TYPES` (regenerated); they have no invariant
  companion yet.
- Cross-provider reasoning replay is a residual risk under `max-quality` (all
  routes share one pi-ai adapter, so replay envelopes are not auto-stripped on a
  switch); `balanced` / `max-stability` avoid it by keeping thinking off.
- Rate-limit accounting is best-effort and per-process; the router self-corrects
  reactively from real 429s.

## Testing

`packages/llm/free-model-router/tests/` unit-covers the classifier
(daily-vs-minute, every reset-hint format), the ledger (cooldown expiry, daily
rollover, `nearLimit`, Groq bucket folding, snapshot round-trip), pool building
and `selectCandidate` (rank, skip cooling / near-limit, all three policy modes,
prefer-resolved, empty pool), and the profile writer (namespaced routes,
indexed refs, org-level / authless collapse). apiproxy contract specs get the
`router` domain stubs. Host and Client typecheck and the client bundle purity
gate pass.

## Alternatives considered

- **Extend `llm-retry` with model failover.** Rejected: its Agent Note
  explicitly scopes it to same-route retry, and its crash-safe attempt
  reconstruction is keyed per provider — a sibling listener composes with it
  cleanly and keeps each concern's budget independent.
- **A virtual `provider: "auto"` adapter that fans out internally.** Rejected:
  the session log and the Monitor would only ever see `auto/free`, losing
  per-model cost and request attribution; the interceptor approach keeps the
  real route visible on `request/context`.
- **Add `free` / `codingCapable` / `rateLimit` fields to `PiAiModelProfile`.**
  Rejected for v1: a five-file cross-cutting change (per the pi-ai per-model
  declarations note) for metadata only this router consumes; it lives in the
  router's own catalog instead.
- **`CredentialKey` record lists for multi-key.** Deferred: `llm-pi-ai` does not
  iterate records per route today; indexed `CredentialRef`s (`OPENROUTER_API_KEY_2`)
  with one route per key need no adapter change.
- **Live-discover every platform's model roster.** Deferred: the shipped catalog
  works offline and is small to maintain; `router.testKey` already round-trips
  `llm.discoverModels` for validation, and live OpenRouter `:free` discovery can
  layer on later.
