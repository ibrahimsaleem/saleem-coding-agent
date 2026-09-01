# `@ibrahimsaleem/dsh-client-ui-free-model-router`

The **Settings ▸ Free Model Router** panel (browser half). Registers a
`settings.section` page that:

- toggles the router master switch and the "keep local Ollama fallback" option;
- selects the rotation policy (`balanced` / `max-quality` / `max-stability`);
- renders one card per shipped free platform — enable it and paste one or more
  API keys (the local Ollama card takes an endpoint override instead);
- lists every live candidate with its per-minute request count and health badge
  (`available` / `cooling` / `disabled`), marking the one the router would serve
  next.

Every mutation writes through the `router.*` apiproxy domain (which forwards to
`ctx.modelRouter` in `@ibrahimsaleem/dsh-llm-free-model-router`) and the panel
re-reads the router's rebuilt state. The panel refreshes on pushed
`settings/document-updated`, `credentials/reference-updated`, and
`llm/adapters-updated` events.

## Known Limitations and Deferred Work

- **Loopback-only.** The `router.*` write RPCs store credentials and rewrite
  `llm-pi-ai` provider profiles, so the panel is unusable from a remote browser
  — the same constraint as the Models page.
- The candidate health list is a snapshot from the last `router.state()` call,
  not a live stream; it refreshes on mutations and forwarded invalidations.
- No component test suite yet; the store and the wire contract are covered by
  the host package and the apiproxy contract specs.
