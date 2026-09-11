---
name: security-review-methodology
description: Run a complete, evidence-driven security review of a code repository. Use this Skill whenever the user asks for a security review, vulnerability scan, threat assessment, or penetration-test-style analysis of a codebase — it defines the phase order, the subagent fan-out, the judge triage that removes false positives, and the report format.
---

# Security Review Methodology

Follow these phases in order. Do not skip the scope gate and do not skip the judge phase.
A finding that never passed a judge does not go in the report.

## Phase 0 — Scope gate

Before reading a single file, establish and record:

- **What repository**, at what commit or branch.
- **Authorization**: the user must be entitled to have this code assessed. Ask if it is not obvious.
- **Runtime scope**: which services you may build and run locally. You may test ONLY instances you
  launched yourself on this machine. Never point a scan, fuzzer, or exploit at an external host,
  a third-party API, a staging or production endpoint, or any address the user did not stand up for you.
- **Depth**: full review, or a named subsystem.

Open a goal (`goal` tool) for the review so the objective survives compaction. Write the scope into it.

If authorization or runtime scope is unclear, use `ask_user_question`. Do not guess.

## Phase 1 — Reconnaissance

Build a map before you look for bugs.

1. Read the manifests (`package.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Cargo.toml`).
   Note the framework, the auth library, the database driver, the templating engine.
2. Find the entry points: HTTP route definitions, CLI commands, queue consumers, scheduled jobs,
   webhook receivers.
3. Find the trust boundaries: where does untrusted input enter? Where does the code cross into a
   shell, a SQL statement, a filesystem path, a deserializer, an HTTP client, or a template?
4. Locate the secrets handling, the session/token logic, and the authorization checks.

Record the map in your todo list as the scan plan. Recon is read-only — no builds, no execution.

## Phase 2 — Static scan (subagent fan-out)

Split the codebase into coherent modules (by directory, by route group, or by layer) and dispatch
**one `subagent` per module**, in parallel. Give each subagent:

- the exact file list for its module,
- the recon map's trust boundaries,
- the instruction to report findings as a structured list, each with `file`, `line`, `class`,
  `severity`, `evidence` (the actual code), and `why-exploitable`.

Tell each subagent to look for, at minimum: injection (SQL/command/LDAP/template), XSS and output
encoding, authentication and session flaws, authorization gaps and IDOR, SSRF, path traversal and
arbitrary file read/write, insecure deserialization, secrets in source, weak or misused crypto,
race conditions in security-relevant paths, and unsafe defaults in configuration.

A subagent that finds nothing reports nothing — that is a valid result, not a failure.

## Phase 3 — Exploit-chain analysis

Individually-minor findings compose. On the merged finding list, look for chains:

- an information leak that reveals a path, feeding a traversal;
- a low-privilege write, feeding a code path that executes what it wrote;
- a CSRF plus a state-changing endpoint;
- an SSRF plus an internal metadata service.

Chains are findings in their own right, and they usually outrank their components in severity.
Record each chain with the exact step sequence.

## Phase 4 — Runtime validation

For every finding whose exploitability is not obvious from the code alone, prove it.

- Build and run the service **locally** — Docker or native, in a background job (`run_in_background`)
  so the review keeps moving.
- Write the smallest possible proof: one request, one payload, one observed effect.
- **Non-destructive only.** Demonstrate impact without destroying data, exhausting resources,
  installing persistence, or touching anything outside the instance you started.
- Capture the exact request and the exact response as evidence.

A finding that fails runtime validation is downgraded or dropped — say so explicitly.

## Phase 5 — Judge triage (adversarial)

For **each** candidate finding, dispatch a `subagent_fork` — it inherits this review's context — with
a single instruction: *argue that this finding is a false positive.* The judge must check:

- Is the sink actually reachable from untrusted input?
- Is there a sanitizer, a framework-level protection, or a validation layer the scanner missed?
- Is the "vulnerable" code dead, test-only, or behind a flag that is off?
- Does the claimed severity match the actual impact?

Keep the finding only if the judge fails to kill it. Record the judge's argument and your rebuttal.
This phase routinely removes a third of a raw scan's output; that is the point.

## Phase 6 — Report

Write the report to a file in the workspace. Structure:

1. **Scope** — repository, commit, what was and was not covered, runtime scope.
2. **Summary** — counts by severity, and the three things that matter most.
3. **Findings** — one section each, ordered by severity. Every finding carries:
   title, severity and why that severity, `file:line`, the evidence code, the exploit path or
   chain, the runtime proof (if any), the judge's challenge and why it failed, and a concrete fix.
4. **Not vulnerabilities** — findings the judge killed, and why. This section builds trust.
5. **Coverage gaps** — what you could not assess, and what it would take.

Never include a real credential, token, or piece of personal data you encountered — redact it.

## Phase 7 — Patch branch and pull request (only when asked)

Only if the user explicitly asks for fixes:

1. Create a branch. Never commit to the default branch.
2. One commit per finding, each referencing the finding's title.
3. Re-run the runtime proof against the patched build to show the exploit now fails.
4. Open the PR with the report's finding sections as the body.

## Working rules

- Use `todo_write` to track phases and per-module scans; a long review outlives your context window.
- Use `workflow` when a whole-repo sweep is more naturally one orchestrated script than a manual fan-out.
- Use `ralph` for bounded iterate-until-clean loops (for example, re-scanning after each batch of fixes).
- Prefer `subagent` for independent module scans and `subagent_fork` for judges that need this review's context.
- Web search is available for CVE and advisory lookups against the dependency manifests; fetch is off.
