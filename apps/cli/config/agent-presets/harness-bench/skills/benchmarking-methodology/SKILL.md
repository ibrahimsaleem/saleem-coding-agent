---
name: benchmarking-methodology
description: Design and run a reproducible benchmark comparing systems, models, or configurations. Use this Skill whenever the user asks for a benchmark, an eval suite, a performance comparison, an A/B of two models or prompts, or a scored task run — it defines the pre-registration step, the run matrix, workflow-driven execution, scoring, and honest statistical reporting.
---

# Benchmarking Methodology

A benchmark is a claim about the world backed by artifacts. If a number in the report cannot be
traced to a run on disk, it does not belong in the report.

Follow the phases in order. Phase 1 happens **before** any run executes — that ordering is the
whole point.

## Phase 0 — Question

Pin down what is actually being asked:

- **What is under test?** Models, prompts, configurations, code versions, or whole systems.
- **What is the comparison?** Against each other, against a baseline, or against a fixed threshold.
- **What decision does this inform?** A benchmark built for "which is faster" looks different from
  one built for "is this good enough to ship".
- **What does "better" mean here?** Accuracy, latency, cost, token efficiency, pass rate, or a
  weighted combination the user must choose — not one you invent.

Open a goal (`goal` tool) and record the question. Use `ask_user_question` for the metric weighting
if the user has not specified it; that is a genuine user-owned decision, not something to infer.

## Phase 1 — Pre-registration (do this before running anything)

Write a file that fixes, in advance:

- **The task suite**: every task, with its input and its success criterion. A task whose criterion
  is decided after seeing the output is not a task, it is a rationalization.
- **The systems under test**, with exact versions and full configuration.
- **Controlled conditions**: identical prompts, identical context, identical limits (timeout, max
  tokens, retries) for every system. Any intentional difference is a named variable.
- **Sample size**: runs per task per system. Stochastic systems need repetition — 1 run is an
  anecdote. Justify the number.
- **The metrics and the scoring rubric**, including how partial credit works.
- **What counts as a failure**: timeout, error, malformed output, refusal. Each gets a category.

This file is the contract. If you change it mid-benchmark, the change and its reason go in the
report — you do not silently re-register.

## Phase 2 — Harness construction

Build the execution scaffold before the real run:

1. Write the runner so a single `(system, task, run-index)` triple executes end to end and writes
   one artifact: input sent, raw output, latency, token counts, cost, exit status.
2. **Smoke-run the matrix at N=1** across every system and a couple of tasks. Confirm artifacts
   land, scoring parses them, and no system is misconfigured. A benchmark that ran for an hour on a
   broken adapter has produced nothing.
3. Fix the artifact schema now. Post-hoc schema changes invalidate earlier runs.

## Phase 3 — Execution (workflow-driven)

Use `workflow` as the primary driver: a benchmark matrix is naturally one deterministic script that
fans runs across systems and tasks, which is exactly what workflows are for. Within it, each
individual run can be a `subagent` when the task itself requires agentic work.

Rules during execution:

- Long batches run as background jobs (`run_in_background`) so the suite keeps moving.
- **Never tune a system mid-run.** If you discover a misconfiguration, stop, fix it, and re-run that
  system's full matrix. Reporting a mixed set of conditions as one result is the most common way a
  benchmark becomes false.
- Record every run, including failures, timeouts, and errors. Dropping bad runs inflates every
  score that survives.
- Checkpoint progress to disk with `todo_write` and artifact files; a long matrix outlives your
  context window.

## Phase 4 — Scoring

Score from artifacts, never from memory of what you saw.

- **Deterministic criteria** (exact match, test passes, schema valid): score programmatically.
- **Judgement criteria**: dispatch `subagent_fork` graders that inherit the rubric. Each grade
  carries `task-id`, `system`, `run`, `score`, and the reasoning.
- **Measure grader reliability**: re-score a random sample with a second grader and report the
  agreement rate. Low agreement means the rubric is weak — report that rather than hiding it.
- Blind the grader to which system produced an output wherever it is practical to do so.

## Phase 5 — Analysis

- Report **mean and spread**, not just the mean. A system that is better on average and wildly
  inconsistent is a different product from one that is steadily slightly worse.
- State sample size beside every number.
- **Do not rank differences inside the noise.** If the gap is smaller than the run-to-run variance,
  the honest finding is "no measurable difference at this sample size".
- Break results down by task category — an aggregate score usually hides the interesting structure.
- Report failure modes separately: timeouts and errors are results, and a system that is fastest
  when it works and fails a fifth of the time should not look fastest.

## Phase 6 — Report

Write to a file in the workspace:

1. **Question** — what was asked, what decision it informs.
2. **Pre-registration** — the suite, conditions, sample size and metrics as fixed in Phase 1, plus
   any mid-run change and why.
3. **Results** — tables with sample sizes and spread. Per-category breakdown.
4. **Failures** — counts by category, per system.
5. **Findings** — what the data supports, stated no more strongly than the data allows.
6. **Limitations** — sample size, conditions not controlled, tasks not covered, version drift.
7. **Reproduction** — the exact commands and artifact locations to re-run and re-score.

If the result is inconclusive, the report says it is inconclusive. That is a successful benchmark.

## Working rules

- `workflow` first for the matrix; `subagent` for an individual agentic run; `subagent_fork` for
  rubric graders; `ralph` for bounded repeat-until-stable sampling.
- Every number traces to an artifact path. Include the path in the results table.
- Web search is available for published benchmark definitions and baseline numbers; fetch is off.
