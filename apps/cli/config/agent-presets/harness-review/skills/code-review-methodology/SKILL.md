---
name: code-review-methodology
description: Run a thorough, evidence-driven code review that finds real bugs. Use this Skill whenever the user asks for a code review, a bug hunt, a regression check, a PR review, or an assessment of test coverage — it defines the phase order, the subagent fan-out, the adversarial verification that removes false positives, and the report format.
---

# Code Review Methodology

Follow these phases in order. Do not skip verification. A finding that survived no
challenge is a guess, and a guess in a review costs the reader more time than it saves.

## Phase 0 — Scope

Establish before reading code:

- **What am I reviewing?** A diff or branch, a pull request, a subsystem, or the whole repository.
- **Against what?** A base commit, a released version, or nothing (a standing audit).
- **What does the user care about?** Correctness, a specific suspected bug, regression risk,
  test coverage, or readiness to ship.

Open a goal (`goal` tool) so the objective survives compaction. If the scope is a diff, get the
exact diff first — `git diff`, `gh pr diff` — and do not review files it never touched unless the
change reaches into them.

Use `ask_user_question` only for things inspection cannot answer. Do not ask where code lives.

## Phase 1 — Change inventory

Build the map before judging anything.

1. List every changed file and classify it: logic, config, test, generated, vendored.
2. For each logic change, identify what it is *supposed* to do — from the commit message, the PR
   description, the tests, and the surrounding code.
3. Identify the blast radius: who calls this? What did the old behaviour guarantee that the new
   behaviour might not? Use `grep`/search, not intuition.
4. Note anything generated or vendored and exclude it from review, explicitly.

For a whole-repository audit, substitute a module map: entry points, layers, and the boundaries
between them.

Record the inventory in `todo_write`. It is the scan plan for the next phase.

## Phase 2 — Per-module review (subagent fan-out)

Dispatch **one `subagent` per module or coherent change group**, in parallel. Give each:

- its exact file list and the relevant diff hunks,
- the intended behaviour from Phase 1,
- the instruction to report findings as `file`, `line`, `class`, `severity`, `evidence` (real code),
  and `failure-scenario` (concrete inputs/state → wrong output or crash).

Direct each subagent at the defect classes that actually bite:

- **Correctness**: off-by-one, wrong operator, inverted condition, wrong variable, unit mismatch.
- **Null/undefined and error paths**: unchecked returns, swallowed errors, error branches that
  silently succeed, `catch` blocks that lose the cause.
- **Boundaries**: empty collection, single element, maximum size, zero, negative, unicode.
- **State and lifetime**: use-after-free/close, leaked handles and listeners, mutation of shared
  state, stale cache, iteration during mutation.
- **Concurrency**: races, missing await, unawaited promises, lock ordering, non-atomic
  read-modify-write.
- **Contract drift**: a caller that assumes an invariant the callee no longer holds; a changed
  default; a widened or narrowed type that callers depend on.
- **Resource handling**: unbounded growth, missing backpressure, missing timeout.

A subagent that finds nothing reports nothing. That is a valid result.

## Phase 3 — Cross-cutting analysis

Per-module review misses whole-system defects. On the merged list, look for:

- the same bug repeated in several modules (one root cause, not N findings);
- a changed invariant in one module that breaks an unchanged caller in another;
- two individually-correct changes that are wrong in combination;
- an interface whose contract the change alters without updating every implementer.

These usually outrank their components. Record each with the exact interaction.

## Phase 4 — Test-gap assessment

For each surviving finding, and for each significant change:

- Does a test cover this path? Find it and read it — a test whose name matches is not proof.
- Would the test have *caught* this bug? Many tests assert only the happy path.
- Is the test asserting behaviour, or asserting the implementation it was written against?

Report the gap as a finding when a real defect could ship unnoticed. Name the specific missing case,
not "needs more tests".

## Phase 5 — Verification (adversarial)

For **each** candidate finding, dispatch a `subagent_fork` — it inherits this review's context —
with one instruction: *argue that this finding is wrong.* The verifier must check:

- Is the code path actually reachable? With what inputs?
- Is there a guard, a caller-side check, or a type constraint the reviewer missed?
- Is the code dead, test-only, or behind a disabled flag?
- Does the claimed severity match the real consequence?

Keep the finding only if the verifier fails to kill it. Where it is cheap and safe, prove the
finding instead: write the failing test, run it, and record the actual output. A finding backed by
a red test needs no further argument.

Record the challenge and your rebuttal for every surviving finding.

## Phase 6 — Report

Write the review to a file in the workspace. Structure:

1. **Scope** — what was reviewed, against what base, what was excluded and why.
2. **Summary** — counts by severity, and the issues that should block a merge.
3. **Findings** — ordered by severity. Each carries: title, severity and why, `file:line`, the
   evidence code, the concrete failure scenario, the verifier's challenge and why it failed, and a
   specific fix.
4. **Unverified suspicions** — things that look wrong but that you could not prove. Marked clearly,
   never mixed in with confirmed findings.
5. **Not defects** — what the verifier killed, and why. This is what makes the rest credible.
6. **Test gaps** — the specific missing cases.

Rank by impact on the user of the software, not by how clever the catch was.

## Working rules

- Use `todo_write` to track phases and per-module reviews; a real review outlives your context window.
- Use `workflow` when a whole-repo sweep is more naturally one orchestrated script than a manual fan-out.
- Use `ralph` for bounded iterate-until-clean loops — re-reviewing after each batch of fixes.
- Prefer `subagent` for independent module reviews and `subagent_fork` for verifiers that need this context.
- Run the tests and the build when a finding depends on runtime behaviour. Report what actually
  happened, including results that contradict your hypothesis.
- Style opinions are not findings. If the project has a linter or a conventions document, defer to it.
