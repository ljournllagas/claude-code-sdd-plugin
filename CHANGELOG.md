# Changelog

## 0.6.8 (2026-10-15)

Fixes from the first real dry run (Scenarios 1, 2, 3 and 5 on Claude Code 2.1.300; results in `test/fixtures/dry-run-scenarios.md`).

### Added
- `plan.mjs check`: a pending task's `Verify:` line may run only commands from the manifest's Verify block. A targeted `testOne` command there meant the whole suite never ran in a FULL run (the planner used one to sidestep a failing suite). Red and Green may still be targeted.
- `marker.mjs baseline` refuses before stage `executing` (FULL) or `quick-dev` (QUICK), and never re-records `base`. A team-lead had recorded both at triage, which would put commits made during spec work into the run diff.

### Changed
- QUICK brief: a `Narrow tests:` line carries `verify.testOne`; the developer narrows its tests with it, and with no such line runs none. A QUICK developer had run the whole suite.
- Developer return: `Files changed`/`Files created` are paths relative to the project root; `TASK-DONE` carries a `Diff review:` line, and the step-6 diff review is required for every task (no developer had run it).
- Team-lead: a dispatch prompt holds only its template's lines; no notes of its own (one had added a `Note:` steering a retry).
- Team-lead: a code-review record holds the reviewer's whole return, copied unchanged (a QUICK record had been paraphrased).
- Planner and plan template: `Verify:` uses only the Verify block's commands.
- Dry-run Scenario 5 plants an always-failing test instead of a failing `verify.test`, which the planner could avoid. README: headless sessions need `/sdd:sdd`.

## 0.6.7 (2026-10-15)

Fixes from the seventh developer-agent audit.

### Added
- `verify.mjs --expect-tests`: a test command that exits 0 having run no test (a filter or path that selects none) fails with `ran no tests`. The runners' "none ran" signs live in `config/detectors.json` (`noTestsRan`). The developer uses it for `Red:`, `Green:` and QUICK narrowed tests; such a run is a design gap, never a pass.
- Team-lead: on `TASK-DONE` it reads the report's `Red:` line and records `tasks.<id>.red_proven` in the marker when Red failed as required. A `skipped` Red on a non-FF dispatch is noted as `Red skipped without cause`. Done tasks with a `Red:` line and no proven Red go to the code reviewer as `Red unproven:`, and the reviewer checks that their tests would fail without the change.

### Changed
- Developer FF dispatch: when the task's test code is not in place yet, the developer writes it and runs `Red:` once (not a round) before touching the implementation, reporting `failed: …` only when it fails for the stated reason, else `not proven (FF: <why>)`. Red is waived only when the tests were already present.
- Developer: at most one diagnostic run per command between two code changes; the `Runner:` re-run after a passing diagnostic run is final. The pre-return review runs at most twice without a round in between.
- Developer return: `TASK-BLOCKED`'s `Notes:` carries the QUICK paths outside the expected paths and QUICK reuse, as `TASK-DONE`'s does.

## 0.6.6 (2026-10-15)

Fixes from the sixth developer-agent audit.

### Added
- `verify.timeoutMinutes` (default 30): `verify.mjs` stops a command that runs longer and reports it as failed, so a watch mode or a prompt no longer hangs a developer or the team-lead.

### Changed
- Developer: every command runs non-interactively (no watch mode, dev server or prompt); the one diagnostic run keeps only its last 200 lines.
- Developer: the names and signatures the task gives (`symbol:`, `Consumes:`, `Produces:`) are binding; when naming sources disagree, the task wins, then `CONTEXT.md` for domain concepts, then the surrounding idiom; "no comment by default" yields to a repository that documents every symbol of that kind. The pre-return diff review also checks names, comments and abstractions the recipe does not name.
- Developer QUICK: a brief has no `Reuse:` line, so the developer searches for existing code, a standard-library feature or a declared dependency before writing new logic, and names what it reused under `Notes:`.
- Developer: a dependency the project's manifest does not declare is new, even when installed transitively.
- Developer: a required command that was already failing on code outside the Files list is not fixed; it returns `TASK-BLOCKED: environment — pre-existing failure: <command>`.
- Developer return: `TASK-BLOCKED` carries `Red:`, `Green:` and `Verify:` lines (`not run` when a command did not run); in an FF dispatch `Files changed` lists every Files path that differs from the last commit, including those that already carried edits.

## 0.6.5 (2026-10-15)

Fixes from the fifth developer-agent audit.

### Changed
- Developer: a **Manual task** (no `Red:`, `Green:` or `Check:` line, proved only by `Verify: Manual:`) has a defined path: Red is skipped and reported `skipped (Manual)`, Green as `none — Manual`. Planner and task template now agree: a Manual task has no `Check:` line (the planner used to allow `Manual:` steps in place of Red/Green).
- Developer: reads `CONTEXT.md` when it exists and names domain concepts with its terms.
- Developer: the stop rules are exact: 3 rounds *in a row* with the same failure; at most one diagnostic run per failure; the Red re-run after creating an empty shell is one run (not a round) that must then fail for the stated reason; a failing re-run after the pre-return cleanup is a round.
- Developer: runs every command from the project root, where the team-lead verifies.
- Developer: a `create` path that already exists (outside an FF dispatch) is a design gap; existing code that duplicates what a `Reuse: none` task builds is a design gap; the pre-return diff review confirms each `Reuse:` item is called.
- Developer QUICK: adds only the tests the goal needs; changes no build, CI, tool configuration or lockfile unless the goal names it; runs no tests when the test command cannot be narrowed (the team-lead runs the suite); names every path outside the expected paths under `Notes:`.
- Developer return: each command line reports that command's last run.

## 0.6.4 (2026-10-15)

Fixes from the fourth developer-agent audit.

### Changed
- Developer: `TASK-DONE` needs every required command to have passed after the last code change; when the pre-return check undoes a path or trims the diff, `Green:`/`Check:` and the step-4 commands run once more (not a round). The check decides whether the task needs a stray path before undoing it.
- Developer: in a test file the task modifies, the given tests are added and the existing ones kept (replaced only when the task says so); the planner states which.
- Developer: QUICK records the start snapshot and runs the pre-return check against the paths it changed on purpose, so files a command created are undone and the reported list is exact.
- Developer return: `Files changed`/`Files created` come from the git comparison (QUICK too), else from the developer's own edits; both returns carry a `Rounds:` line; `TASK-DONE` names `quick-fix` for a review fix.
- Developer: the `Reuse:` rule covers existing code, standard-library features and dependencies, not only helpers; "the same failure" is the same command failing on the same first error line; a diagnostic run never decides a result (a pass there is confirmed by one more `Runner:` run); a non-git project reviews the files it created or changed.
- Team-lead: the QUICK dispatch template has a `[User guidance:]` slot, as the FULL one does.

## 0.6.3 (2026-10-15)

Fixes from the third developer-agent audit.

### Changed
- Developer: a round is defined (one code change and the `Green:`/`Check:` run); one diagnostic re-run for more output is allowed and is not a round, which removes the contradiction with "re-run only after a change"; a flaky command is judged by its last run and named under `Notes:`.
- Developer: `TASK-DONE` needs every command step 4 requires to pass on its last run (not only the commands it chose to run); a narrowed form of the `test` command is also left to the team-lead.
- Developer: a `User guidance:` line narrows how the task is done, never its scope; the QUICK review-fix dispatch fixes only the blockers marked `fix`, under the FF rules.
- Developer: before returning it reads `git diff` of its Files and removes lines the task does not need; the snapshot rule names paths outside the Files list, so it no longer reads as forbidding fix-forward edits.
- Developer return: `TASK-BLOCKED` gains a `Notes:` line; Green/Check/Verify carry the runner's line; QUICK fills the Green slot with its narrowed tests; the Red line notes an empty shell created before the second run. The dependency rule is stated once.

## 0.6.2 (2026-10-15)

Fixes from the developer-agent re-audit, plus the anti-hardcoding rule.

### Changed
- Developer: the smallest-change, `Reuse:`/YAGNI and no-refactor rules move to **Always**, so they bind QUICK work too (they were FULL-only).
- Developer: implement the behaviour, not the examples — no special-casing of test inputs or hardcoded expected values.
- Developer: the task's test code is fixed once written; a wrong given test is a `design-gap`. An FF dispatch writes the task's tests when they are missing (only the Red run is waived), so a first-attempt FF dispatch no longer skips them.
- Developer: records a start snapshot (`git status`) before editing; the pre-return scope check undoes only paths that changed in this attempt and never touches a path in the snapshot (it used to "undo" changes it could not attribute).
- Developer: no formatter or auto-fix unless the task names it, also on listed files (it could reformat untouched lines); at most 5 rounds in total besides the 3-same-failure stop; debug output and scratch files are removed before returning.
- Developer: Red is skipped only for a `Check:` task, an FF dispatch or QUICK (`Manual:` replaces `Verify:`, not Red); a `Verify: Manual:` line is reported as left to the user; `Notes:` lists undone paths; QUICK narrows the test command to the tests it touched when the tool allows it; the description no longer claims test-first for QUICK.
- Team-lead: the FF dispatch lines say "never restore or delete a path that already carried edits when this attempt started", matching the developer prompt.

## 0.6.1 (2026-10-15)

Fixes from the developer-agent audit.

### Fixed
- `verify.mjs`: the developer's runner (`--cmd` without `--key`) no longer applies the `verify.external` gate. With `verify.external: true`, every developer command used to report `fail`, so no task could finish; with `verify.externalCommand` set, that command ran on every developer command.
- Dispatch templates quote the runner's command with single quotes, as the developer prompt does.

### Changed
- Developer: Red that fails for another reason stops the task (except a missing file or export the task creates); `TASK-DONE` only when every command it ran passed; at most 3 rounds ending in the same failure, and a fail-then-pass with no change is reported as flaky; no installer, generator or auto-fix that writes outside the Files list; a `git status` check against the Files list before returning; a missing or unfit `Reuse:` helper is a design gap; no reformatting of untouched lines.
- Developer return: the Red line carries its command and the failing line; a `Check:` slot and a `Notes:` line; a `TASK-BLOCKED` return also lists the files changed and created, with its evidence.

## 0.6.0 (2026-10-15)

Token savings and the fixes from the agent audit.

### Added
- `bin/card.mjs`: routes a delegation in one command. It builds the card from the plan (developer, EXPAND batch, plan review) or from flags, and with `--record` writes the attempt entry to the marker, including the tier reset on escalation (`--retry`, `--resume`).
- `bin/marker.mjs`: the only way the team-lead changes `.sdd/active.json` (`init`, `set`, `del`, `push`, `fail`, `baseline`, `preflight`), plus the shared git facts (changed paths relative to the project, run artifacts).
- `bin/verify.mjs`: runs a verify set (a task's `Verify:` line, the QUICK set or explicit commands) and prints one line; a failure's last 40 lines go to the task's failure file. It enforces `verify.external` (waiver file or `verify.externalCommand`), which nothing used before.
- `bin/task-done.mjs`: the success path of a task in one command (mark `[x] done`, leftover-edit stop, commit of the task's Files only, pass outcome line).
- `outcome.mjs --from-marker`: reads slug, tier, source, reason and first-attempt from the marker instead of hand-copied flags.
- `plan.mjs check --paths`: `modify` targets and `create` directories must exist or be created by an earlier task. Every check now also rejects a task with no `Reuse:` line.
- `cite-check.mjs` checks the spec's frontmatter block.

### Changed
- The playbook is split: `team-lead.md` (core: §0–§2, §11, §12) is always read; `quick.md`, `full.md`, `execution.md`, `stops.md`, `amendments.md`, `resume.md` (§13) and `legacy.md` (§14) are read only when the run needs them. A QUICK run loads about 40 KB of playbook instead of 63 KB.
- Team-lead: runs `doctor.mjs` before resuming; passes the triage paths, a spec size (`light` for small non-risky FULL work), the AC cap, the task-file line cap and a grounding-notes path to the agents it dispatches.
- Analyst: starts from the triage paths with a bounded search; light specs answer non-applicable headings with "None identified"; the AC cap comes in the prompt.
- Planner: writes grounding notes at OUTLINE that EXPAND batches read (and extend) instead of re-exploring; backticks each Verify command; prefers the targeted `testOne` command for `Green:`. EXPAND batches route on their tasks' own summaries.
- Developer: runs commands through the `verify.mjs` runner (one line or a 40-line tail); runs `Green:` and the non-test Verify commands but leaves the full suite to the team-lead; QUICK work starts from the expected paths and stops at 5 files.
- Reviewer: code mode reads the spec's ACs and the plan index (FULL) or the goal (QUICK) and can flag an unimplemented AC; spec and plan modes skip everything the scripts already check; amendments are reviewed block by block (`Review only these blocks`).
- `stageFloors.reviewer-code` is `standard`: the final review never routes to the lightest model.
- `limits.maxAcceptanceCriteria` and `limits.maxTaskFileLines` are validated with the other limits.

### Fixed
- The layout test now lists `README.md` (it failed after the README was added).

## 0.5.3 (2026-10-14)

### Fixed
- Applied residual audit fixes from independent re-audit: planner duplicates, reviewer token preservation.
- Kept all tests passing after agent-prompt cleanup.

## 0.5.2 (2026-10-14)

### Fixed
- Reviewer calibration wording no longer duplicated by output format (single cap/tier rule).
- Planner rules 3 and 8 merged for size; reduced cross-mode references.
- Scope/citation/reuse guidance kept punchy and mode-independent.

## 0.5.1 (2026-10-14)

### Changed
- Agent prompts now make DRY/KISS/YAGNI and minimum-change explicit, with concrete guardrails per agent.
- Analyst: scope gate (`limits.maxAcceptanceCriteria`) plus citation awareness in its rules.
- Planner: added minimum-size rule and pre-Recipe reuse requirement.
- Reviewer: enforced clearer must-fix vs should-fix separation, 10-blocker cap, and finding structure.
- Developer: added repo-default naming/comment guidance and minimal-change rule.

### Fixed
- Developer contract retained required tokens for `Reuse:`/reimplementing from lint checks.

## 0.5.0 (2026-10-14)

### Added
- Spec citation gate (`bin/cite-check.mjs`): verifies every `path:line` citation in a spec's Background.
- Spec size/scope gate (`bin/scope-check.mjs`): rejects oversized specs via `limits.maxAcceptanceCriteria`.
- Run diagnostic command (`bin/doctor.mjs`): validates the active marker and referenced artifacts.
- Plan task-file budget: `limits.maxTaskFileLines` enforced by `plan.mjs check`.
- Out-of-band verification support: `verify.external`, `verify.waiverFile`, `verify.externalCommand`, plus `bin/verify-waiver.mjs`.
- Developer agent guidance: explicit DRY/KISS/YAGNI, minimal change, naming, and comment rules.

### Changed
- Developer agent now requires reusing named helpers and forbids unlisted refactoring.
- Outcome and status tooling continues to record developer attempt results and sliced plan progress.

### Fixed
- Consolidated review-gate and resume behavior for split and legacy plans (carried from 0.4.x work).

## 0.4.0 (2026-10-08)

### Added
- Frontmatter status, artifact index, and reuse checks.
- Split plans, outline expansion, and sliced execution.
- `bin/plan.mjs` mechanical checks and `bin/status.mjs` dashboard.
- `bin/outcome.mjs` for recording developer attempt verdicts.
- `/sdd`, `/sdd-init`, `/sdd-status` commands.

## 0.3.0 (2026-10-08)

### Added
- Build property, routing ladder, and initial implementation teams.
- Legacy/upgrade compatibility groundwork.