/**
 * The template catalog: the four known-good preset compositions a generated
 * harness is built from, and the bounded set of knobs a generated spec may
 * turn on each one.
 *
 * A template is named by the id of a preset that the ROSTER already carries
 * (shipped under `apps/cli/config/agent-presets/`), not by a path here — the
 * factory copies it through `agentPresets.copy()`, which resolves ids. That
 * keeps one source of truth for what a template contains: the composition file
 * a human wrote and this repository tests.
 *
 * Every template's row graph is identical and complete — shell, filesystem,
 * search, jobs, skills, goals, todo, ask-user, web, plan mode, compaction, and
 * the full delegation stack (subagent spawn AND fork, subagent control,
 * workflows, ralph). Templates differ only in persona, bundled skill, and which
 * toggles make sense. That uniformity is deliberate: it means a generated
 * harness is never quietly less capable than the template it came from.
 * @module @ibrahimsaleem/dsh-harness-factory/templates
 */

/** One row toggle a spec may name, mapped to the composition row it flips. */
export interface HarnessToggle {
  /** The id a spec uses (`enable: [...]`). */
  readonly id: string
  /** The composition row id this flips, searched at any nesting depth. */
  readonly row: string
  /** What turning it on means, shown to the user and given to the generator. */
  readonly label: string
  /** Whether the template ships with this row already enabled. */
  readonly defaultOn: boolean
}

/** One harness template: a seed preset plus the knobs a generated spec may turn. */
export interface HarnessTemplate {
  /** Catalog id — what a spec's `template` field names. */
  readonly id: string
  /** Roster id of the shipped preset whose directory is copied. */
  readonly seed: string
  /** Display title for the template card. */
  readonly label: string
  /** One-paragraph description of what this shape of harness does. */
  readonly blurb: string
  /** The phases the bundled skill walks, shown on the card and given to the generator. */
  readonly phases: readonly string[]
  /** The skill directory the seed ships, and the one a generated skill replaces by default. */
  readonly skill: string
  /** Row toggles a generated spec may name for this template. */
  readonly toggles: readonly HarnessToggle[]
}

/**
 * Toggles every template shares. They are all rows present in each seed
 * composition, so flipping one is a `disabled:` edit and never a new row —
 * the factory cannot add capability a template did not already carry.
 */
const COMMON_TOGGLES: readonly HarnessToggle[] = [
  { id: 'web-search', row: 'tool-web', label: 'Web search for advisories, docs and baselines', defaultOn: true },
  { id: 'plan-mode', row: 'plan-mode', label: 'Plan mode — plan the work before executing it', defaultOn: true },
  { id: 'subagents', row: 'tool-subagent', label: 'Parallel subagents for fan-out work', defaultOn: true },
  { id: 'judge', row: 'tool-subagent-fork', label: 'Forked judge/verifier agents that inherit context', defaultOn: true },
  { id: 'workflows', row: 'tool-workflow', label: 'Deterministic multi-agent workflow scripts', defaultOn: true },
  { id: 'ralph', row: 'tool-ralph', label: 'Bounded iterate-until-done loops', defaultOn: true },
  { id: 'background-jobs', row: 'tool-jobs', label: 'Background jobs for long builds and runs', defaultOn: true },
  { id: 'goals', row: 'tool-goal', label: 'Long-running goals that survive compaction', defaultOn: true },
  { id: 'ask-user', row: 'tool-ask-user', label: 'Ask the user when a decision is genuinely theirs', defaultOn: true },
]

/** The shipped templates, in the order the picker shows them. */
export const HARNESS_TEMPLATES: readonly HarnessTemplate[] = [
  {
    id: 'security',
    seed: 'harness-security',
    label: 'Security review',
    blurb:
      'Scans a repository for vulnerabilities and writes an evidence-backed report. Fans per-module '
      + 'scanners across subagents, chains findings into exploit paths, proves them against a service it '
      + 'runs locally, and puts every candidate through an adversarial judge before it reaches the report.',
    phases: [
      'Scope gate',
      'Reconnaissance',
      'Static scan (subagent fan-out)',
      'Exploit-chain analysis',
      'Runtime validation',
      'Judge triage',
      'Report',
      'Patch branch and PR (on request)',
    ],
    skill: 'security-review-methodology',
    toggles: COMMON_TOGGLES,
  },
  {
    id: 'review',
    seed: 'harness-review',
    label: 'Code review',
    blurb:
      'Finds real bugs in a diff or a whole repository. Builds a change inventory, fans per-module '
      + 'reviewers across subagents, looks for defects that only appear across module boundaries, assesses '
      + 'test gaps, and has every finding challenged before it is reported.',
    phases: [
      'Scope',
      'Change inventory',
      'Per-module review (subagent fan-out)',
      'Cross-cutting analysis',
      'Test-gap assessment',
      'Adversarial verification',
      'Report',
    ],
    skill: 'code-review-methodology',
    toggles: COMMON_TOGGLES,
  },
  {
    id: 'redteam',
    seed: 'harness-redteam',
    label: 'Red team / model behaviour',
    blurb:
      'Measures how a target model behaves under adversarial pressure. Confirms scope and authorization '
      + 'first, designs a reproducible probe suite, runs it with repetition, grades transcripts against a '
      + 'fixed rubric, and reports refusal consistency with honest sample sizes.',
    phases: [
      'Scope gate (blocking)',
      'Probe-suite design',
      'Target setup',
      'Systematic runs (subagent fan-out)',
      'Grading',
      'Analysis',
      'Report',
    ],
    skill: 'redteam-methodology',
    toggles: COMMON_TOGGLES,
  },
  {
    id: 'bench',
    seed: 'harness-bench',
    label: 'Benchmarking',
    blurb:
      'Runs reproducible benchmarks across systems, models or configurations. Pre-registers the task '
      + 'suite and conditions before any run, drives the matrix through a workflow, scores against a fixed '
      + 'rubric, and reports numbers that each trace back to a stored artifact.',
    phases: [
      'Question',
      'Pre-registration',
      'Harness construction',
      'Execution (workflow-driven)',
      'Scoring',
      'Analysis',
      'Report',
    ],
    skill: 'benchmarking-methodology',
    toggles: COMMON_TOGGLES,
  },
]

/**
 * Look up one template by catalog id.
 * @param id - the catalog id a spec named.
 * @returns the template, or undefined when the id is not in the catalog.
 */
export function findTemplate(id: string): HarnessTemplate | undefined {
  return HARNESS_TEMPLATES.find(template => template.id === id)
}

/**
 * The toggle allowlist in the shape {@link parseHarnessSpec} checks against.
 * @returns toggle ids by template id.
 */
export function toggleAllowlist(): Record<string, readonly string[]> {
  return Object.fromEntries(
    HARNESS_TEMPLATES.map(template => [template.id, template.toggles.map(toggle => toggle.id)]),
  )
}
