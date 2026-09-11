# @ibrahimsaleem/dsh-harness-factory

Builds runnable agent presets — "harnesses" — from a natural-language description, and packs
one as a standalone folder someone else can unzip and run.

A harness is a specialized agent: a persona, a methodology skill it loads before working, and
a capability set. The four shipped templates cover security review, code review, red-team /
model-behaviour evaluation, and benchmarking.

## The design constraint that shapes everything here

Preset authoring in this harness is **copy-only on purpose**. `agentPreset.write` once accepted
composition text and was deliberately removed
([note](../../../.agents/notes/implemented/simplification/2026-08-08-copy-only-preset-authoring.md)):
the composition dialect includes `!!js`, so a text-accepting seam is arbitrary code execution at
the next mount no matter how carefully the text is shape-checked.

So **the model never writes composition.** The pipeline is:

| Step | What happens | Why it is safe |
|---|---|---|
| **generate** | One bounded LLM call returns a `HarnessSpec` — a JSON object of inert data | No plugin names, no paths, no row ids; every field is validated against the catalog |
| **copy** | `agentPresets.copy(seed, id)` duplicates a shipped template directory | The existing, already loopback-pinned authoring call — no new write capability |
| **render** | The spec is applied to the copy's inert surfaces only | Persona text, skill markdown, `preset.yml`, and `disabled:` on allowlisted rows |
| **probe** | The result is **mounted** before the user is told it exists | A composition that cannot load is rolled back, not left on the roster |

The consequence worth stating plainly: **a generated harness cannot be less mountable than its
template, because its row graph *is* its template's** — byte for byte, apart from one persona
scalar and some `disabled:` flags.

The mount probe is the piece the preset system otherwise lacks. Nothing else mounts a
composition before a session needs it, so a broken preset normally surfaces when a session first
tries to start. Here it surfaces during generation, and the half-built preset is removed.

## Templates

Every template carries the **same complete row graph**: shell, filesystem, search, jobs, skills,
goals, todo, ask-user, web, plan mode, compaction, and the full delegation stack — subagent
spawn *and* fork, subagent control, workflows, and ralph. They differ only in persona, bundled
methodology skill, and which toggles make sense. That uniformity is deliberate: a generated
harness is never quietly less capable than the template it came from.

Templates live in `apps/cli/config/agent-presets/harness-*` and are named here by roster id, so
the composition a human wrote and this repository tests stays the single source of truth.

## Capability toggles

A spec's `enable` list names toggle ids from the chosen template's allowlist. Each maps to a row
id that gets `disabled:` flipped — at any nesting depth, so rows inside the `planning`,
`compaction` and `delegation` realm groups are reachable. **Entries the template does not name
are dropped, not honoured**, and reported back to the user as `dropped`. The allowlist is the
authority; the model's output never is.

An empty `enable` list means "template defaults", which is every toggle on.

## Export

`pack(id)` produces a zip laid out as a DSH home plus a launcher:

```
<id>/.dsh/.agent-presets/<id>/   the preset directory, verbatim
<id>/.dsh/settings.yaml          default preset + workspace-write sandbox
<id>/run.sh, <id>/run.cmd        set DSH_HOME, then boot the web profile
<id>/package.json                names the CLI this needs
<id>/README.md                   what it is, how to run it, what it needs
```

The preset relocates safely because `copy()` dereferences symlinks and every template resolves
its bundled skills through `new URL('skills/', baseUrl)` — the preset's own directory — rather
than an absolute path.

**The archive does not contain the harness runtime.** The launcher looks for a CLI installed
beside the harness, then one on `PATH`, and otherwise explains what to install. The README says
this plainly rather than implying the zip is self-sufficient — that honesty is a feature of the
export, not an omission from it.

## Surface

```ts
ctx.harnessFactory.templates()                           // the catalog
ctx.harnessFactory.generate({ prompt, template?, signal }) // LLM → spec → copy → render → probe
ctx.harnessFactory.build(spec, dropped?, signal?)          // the same, minus the model call
ctx.harnessFactory.pack(id)                                // → { filename, bytes }
```

Reached from the browser through the `harness.*` apiproxy domain (`harness.templates`,
`harness.generate`) plus the `/api/harness.export` GET download. All are loopback-pinned in
`PRIVILEGED_METHODS` — generating writes a preset directory and packing reads one back, the same
authority as the already-pinned `agentPreset.copy` / `agentPreset.read` pair.

`agentPresets` is reached through `ctx.get` rather than `inject`, so a deployment with no roster
(headless, ACP, the SDK server) loads this service inert instead of failing to compose.

## Model route

Generation needs an explicit `provider` and `model`: `GenerateOptions` requires both, because
default resolution belongs to `agentDefaultModel`, not the transport. The service resolves its
config first, then the deployment default, and fails with a sentence naming the real problem if
neither supplies one. (Omitting them produces a malformed request that streams nothing, which
surfaces downstream as a useless "the reply contained no JSON object" — this was hit for real.)

## Known limitations

- **Bounded expressiveness.** A request no template covers gets the nearest template plus a
  tailored persona and skill, not a novel row graph. That is the trade for "it always mounts".
- **Generation quality varies by model.** The repair attempt handles malformed JSON, not a weak
  persona. The result view shows what was written so the user can judge it.
- **Superseded standing mounts are never reclaimed** (existing TODO in `agent-presets`).
  Regenerating the same id repeatedly in one process accumulates mounts.
- **Red-team harnesses are dual-use.** Their engagement rules are prompt-level, not enforced.
  The sandbox stays workspace-write and the "only targets you were authorized to test" rule is
  stated in both persona and skill.
