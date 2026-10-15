# Changelog

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