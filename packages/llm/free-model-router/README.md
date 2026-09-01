# `@ibrahimsaleem/dsh-llm-free-model-router`

Run the Saleem Harness fully free. Activate one or more free API platforms and
the router auto-picks a good free coding model per request, then transparently
switches key / model / platform as each hits its per-minute rate limit, spends
its daily quota, or rejects its key — degrading to local Ollama and only then
failing with a clear message.

## What it does

- **`ctx.modelRouter`** owns a shipped catalog of free platforms (Google AI
  Studio, OpenRouter `:free`, Groq, Cerebras, NVIDIA NIM, Mistral, Ollama Cloud,
  Ollama local), a candidate pool (`route × model × key`), and a health/quota
  ledger persisted to `~/.dsh/free-model-router/ledger.json` so a spent free
  tier stays remembered across a restart.
- An **`agent/request`** waterfall listener (registered at boot, so it runs
  outermost and observes the model picker's choice) substitutes the best healthy
  free candidate when the resolved model is a router candidate. A model the user
  picked by hand this session, or any non-pool model, is left alone.
- An **`agent/request-error`** waterfall listener classifies the failure
  (`classifyRateLimit` splits per-minute from daily on the flattened provider
  message + `Retry-After` / `retryDelay` / `X-RateLimit-Reset`), cools or
  disables the candidate, writes a `router/switch` session event, and asks the
  loop to retry — which re-runs `agent/request` and routes to the next healthy
  candidate. Router routes drop `RATE_LIMIT` from `retryPolicy.retryableCodes`
  so `llm-retry` delegates rate limits here regardless of listener order.
- Nothing rate-limit / switch related is model-visible.

## Configuration (`~/.dsh/settings.yaml`)

```yaml
free-model-router:
  enabled: true
  poolPolicy: balanced          # balanced | max-quality | max-stability
  keepLocalFallback: true
  platforms:
    google:     { enabled: true, keys: 1 }
    openrouter: { enabled: true, keys: 2 }
```

Activating a platform (through **Settings ▸ Free Model Router** or a hand edit)
writes the platform's key(s) to `ctx.credentials` and one hand-declared
`llm-pi-ai.providers.free-<platform>` route per key.

## Pool policy

- `balanced` (default) — rank by coding quality, keep thinking off where it can
  be turned off, allow a mid-turn switch only on a hard rate limit.
- `max-quality` — always the top-ranked model including reasoning, switch
  mid-turn freely.
- `max-stability` — non-reasoning models only, switch between turns.

## Known limitations and deferred work

- **Cross-provider conversation state.** All router routes share one
  `llm-pi-ai` adapter instance, so a reasoning-block replay envelope from one
  model can reach another on a mid-turn switch. `balanced` / `max-stability`
  keep thinking off to avoid this; `max-quality` carries a small residual risk.
- **Rate-limit accounting is best-effort and per-process.** Only cooldown and
  daily-quota state is persisted; another harness process or out-of-band API
  usage desyncs the proactive per-minute counters. The router still self-corrects
  reactively from the real 429. A cross-process shared ledger is deferred.
- **Daily-reset timezone is a guess** for platforms other than Google (Pacific)
  and OpenRouter (UTC) — a wrong guess only over/under-cools by hours.
- **Groq limits are per-org, not per-key**, so extra Groq keys add no headroom;
  the catalog marks it and the panel disables "add key".
- **The Settings panel and the activation RPCs are loopback-only.**
- No session-event invariant companion yet; `router/switch` /
  `router/candidate-disabled` are shape-validated only by the persistence
  read path.
