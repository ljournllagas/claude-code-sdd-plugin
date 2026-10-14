# Changelog

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