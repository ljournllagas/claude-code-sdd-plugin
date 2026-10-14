# Changelog

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