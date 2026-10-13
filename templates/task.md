### T1 — <title>   [ ] pending
Satisfies: AC-1
Depends on: none
Lenses: <optional: security | data | contract | performance>
Router summary: <at most 500 characters, plain language, no code; identical to the summary in the manifest's Task index>
Files:
  - create  path/to/new_file     (symbol: Name)
  - modify  path/to/existing     (symbol: Name; lines/region if known)
Consumes:  <full signatures/types, each with its defining task ID or "existing: path">
Produces:  <full signatures/types, errors, side effects>
Reuse:     <existing code (path and symbol), standard-library or native feature, or installed dependency the Recipe calls; or `none — searched <what was searched>, nothing to reuse`>
Tests (complete): <full test code, in the project's language>
Recipe: <numbered prose steps; pseudo-steps only for non-obvious logic; no full implementation bodies>
Red:    <exact command> → expected: fails because <specific reason>
Green:  <exact command> → expected: <specific outcome>
Verify: <exact command(s) from the Verify block> → expected: <outcome>
Commit: <imperative subject, at most 72 characters>

<!-- One task file holds exactly one task and starts with its heading line. A developer agent receives only this file, so it must be executable from its own text plus the repository. A task changes one behaviour and touches at most 5 files. Write a Files path that contains a space in backticks. ID, title, ACs (Satisfies), dependencies, Files paths and Router summary must agree with the task's entry in the manifest's Task index; `bin/plan.mjs check` reports any disagreement. The file name is `T<n>.md` for task `T<n>`. With no `test` command configured: replace Tests with "none — no test command configured", replace Red/Green with `Check: <build/typecheck/lint command> → expected: <outcome>` lines, and where a command cannot prove the task write the Verify line as `Verify: Manual: <steps>` (the line still starts with `Verify:`). -->
