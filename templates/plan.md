# <Feature name> — Plan

**Spec:** <path to the approved spec>
**Status:** draft
**Task count:** <n>

<!-- Every task block must be executable from its own text plus the repository. A developer agent receives only its block. A task changes one behaviour and touches at most 5 files; split otherwise. Tasks form an acyclic dependency graph. Every `modify` target exists; every `create` target's parent directory exists or is created by an earlier task. -->

## Verify block

<!-- Copy the non-null commands from sdd.config.json `verify`, one per line, exactly:
- build: `<command>`
- test: `<command>`
Every Red/Green/Verify command in a task must appear verbatim here (or be the task's own targeted test command built from the `testOne` template). -->

## Accepted risks

None

## Coverage matrix

<!-- Every spec AC appears exactly once on the left.
| AC | Tasks |
|---|---|
| AC-1 | T1 |
| AC-2 | T1, T2 | -->

## Tasks

### T1 — <title>   [ ] pending
Satisfies: AC-1
Depends on: none
Lenses: <optional: security | data | contract | performance>
Router summary: <at most 500 characters, plain language, no code>
Files:
  - create  path/to/new_file     (symbol: Name)
  - modify  path/to/existing     (symbol: Name; lines/region if known)
Consumes:  <full signatures/types, each with its defining task ID or "existing: path">
Produces:  <full signatures/types, errors, side effects>
Tests (complete): <full test code, in the project's language>
Recipe: <numbered prose steps; pseudo-steps only for non-obvious logic; no full implementation bodies>
Red:    <exact command> → expected: fails because <specific reason>
Green:  <exact command> → expected: <specific outcome>
Verify: <exact command(s) from the Verify block> → expected: <outcome>
Commit: <imperative subject, at most 72 characters>

<!-- With no `test` command configured: replace Tests with "none — no test command configured", replace Red/Green with `Check: <build/typecheck/lint command> → expected: <outcome>` lines, and use `Manual: <steps>` for Verify where a command cannot prove the task. -->
