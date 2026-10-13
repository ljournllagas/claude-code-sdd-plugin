# SDD dry-run scenarios (walk once per Kit release on the real harness)

Setup for every scenario: copy `test/fixtures/repo-js` (or `repo-py`) to a fresh temp directory, `git init` it and make one commit (except Scenario 6), start Claude Code there with the Kit loaded (`claude --plugin-dir <path to sdd>`), run `/sdd-init`, accept the detected commands, and write `{"router": {"enabled": false}}` merged into `sdd.config.json` so routing uses the built-in table (a stubbed router; real TypeSafe is exercised by `test/route.test.mjs`). Tick each line only when you saw it happen. Record the date, Claude Code version and any deviation at the bottom.

## Scenario 1 — QUICK happy path

Run: `/sdd add a farewell(name) function next to greet that returns "Goodbye, <name>"` (repo-js).
- [ ] First output is a `▸ triage:` line proposing QUICK with its cost, then the session stops (no agent started).
- [ ] After you confirm: `.sdd/active.json` exists with `lane: QUICK`, `base` = the commit hash, `dirty_at_start: []`.
- [ ] A developer is dispatched with a model from the fallback table (standard → sonnet); `.sdd/decisions.jsonl` has a line with `source: "fallback"`.
- [ ] The team-lead (not the developer) ran `npm test`; then a reviewer ran in `code` mode; a review record `.sdd/review/<slug>-code-r1.md` exists.
- [ ] No spec, no plan, **no commit**; `git status` shows the changes uncommitted; the report says so.
- [ ] `.sdd/active.json` is deleted at the end. `/sdd-status` shows the delegations.
- [ ] While the run was active, asking the main session to edit a source file directly was refused by the guard with the `SDD guard:` message.

## Scenario 2 — FULL happy path

Run: `/sdd add a tally(names) function that returns a map of name to count, plus a CLI wrapper` (repo-py or repo-js).
- [ ] Triage proposes FULL (or you raise it); you confirm.
- [ ] Analyst writes `docs/sdd/specs/<slug>.md` with every template heading; open questions are shown to you with recommendations; you answer; the spec is revised.
- [ ] Spec review runs (round lines `▸ spec review n/3 …`), exits clean or you resolve it; the session **stops** and asks for approval; saying nothing does not advance it.
- [ ] After you approve, the spec's `status:` is `approved` and the planner writes `docs/sdd/plans/<slug>.md`; plan review runs; the session stops for plan approval.
- [ ] After approval: plan `status: executing`; marker `base` is set once; each task: marker `in_progress` true then false, a fresh developer, the team-lead runs the Verify, the task heading becomes `[x] done`, a commit containing only that task's files.
- [ ] One final `code` review over the run diff; report lists tasks, commits, routing summary; plan `status: done`; marker deleted.

## Scenario 3 — Risk-floor refusal

Run: `/sdd rename the column "email" in the users table migration` (any repo; create `db/migrations/001_init.sql` first).
- [ ] Triage shows FULL with the signal named (a `schema` risk flag, or a `riskKeywords` match under the stubbed router).
- [ ] Reply "do it as QUICK": the team-lead refuses, states the signal again, and offers FULL / rescope / abort. It does not proceed as QUICK.

## Scenario 4 — Review stall

Make the reviewer find a blocker that the author cannot fix: after the spec is drafted, edit the spec by hand to add the contradictory requirement "AC-2: the output must be both empty and non-empty" (or ask the analyst for something impossible).
- [ ] The same blocker is reported in two consecutive rounds; the loop exits as **stall** (not cap hit) before round 3.
- [ ] The remaining blocker is shown verbatim and the options offered are exactly Direct / Accept / Reject as out of scope / Abort.
- [ ] Choose **Accept**: the blocker appears verbatim under `Accepted risks` in the spec and the flow reaches the approval gate (it does not skip it).

## Scenario 5 — Task escalation to human

Set `limits.verifyFailuresPerTier` to 1 and `verify.test` to a command that always fails: `node -e "process.exit(1)"` (so no task can ever pass verification). Run a small FULL request.
- [ ] First failure: failure file `.sdd/review/<slug>-<task>.fail.txt` written (last 40 lines); the next dispatch is an FF dispatch (prompt names the failure file and the paths already edited) at the tier the Router returned; `.sdd/decisions.jsonl` shows `source: "escalation"` and `tasks[<id>]` shows `last_tier` moving up with `failures_at_last_tier` reset to 0.
- [ ] After the failure at `deep`: a decision with `human: true`; the session stops offering exactly I fixed it / Retry at deep with guidance / Skip / Abort.
- [ ] Choosing **Skip** lists the leftover edits and offers Keep / Revert; nothing is restored without your confirmation; dependent tasks are marked `[!] blocked`.

## Scenario 6 — No-git project

Copy `repo-js` and do **not** run `git init`. Run `/sdd` with a small QUICK request, then a small FULL request.
- [ ] Marker `base` is `none`, `dirty_at_start` is `[]`.
- [ ] No commits are attempted; the team-lead says so once; the plan checklist records progress.
- [ ] The reviewer received `.sdd/review/<slug>.files` (a list of paths) instead of a diff.
- [ ] No git-only commands (`git add -N`, `git reset`) were run.

## Scenario 7 — Reuse check on a plan (v0.2)

In a repo that already has a small helper (repo-js: `greet`), run `/sdd` for a FULL request that needs the same behaviour (e.g. a `greetAll(names)` that greets each name).
- [ ] The plan's tasks each carry a non-empty `Reuse:` line; the greeting task names the existing helper (path and symbol), not a rewrite.
- [ ] Delete the `Reuse:` line from one task by hand and re-run plan review: the reviewer reports it as a blocker (a missing `Reuse:` line).
- [ ] Replace the Recipe of one task with one that reimplements the existing helper: the reviewer reports it as a should-fix (or a blocker only if it cites the existing symbol by path and it does the identical thing).

## Scenario 8 — Index read by the analyst (v0.2)

In a project with an approved spec in `docs/sdd/specs/` (frontmatter present), run `/sdd` with a request that overlaps it.
- [ ] `docs/sdd/index.md` exists and lists the earlier spec under Specs with its status and description; it was regenerated before the analyst was dispatched.
- [ ] The analyst's dispatch prompt carries an `Index:` line; the new spec cites the related earlier spec in Background and raises the overlap as an open question with a recommendation.
- [ ] The analyst did not open unrelated specs, and did not edit `docs/sdd/index.md`.
- [ ] After the spec is approved, `docs/sdd/index.md` shows the new spec as `approved` and `git status` does not trigger a leftover-edit stop for the Index file.

## Scenario 9 — Unindexed legacy artifact (v0.2)

Put a spec written by an earlier Kit (a `**Status:**` line, no frontmatter) in `docs/sdd/specs/`, then run `/sdd-init` or any `/sdd` request.
- [ ] `docs/sdd/index.md` lists it under Unindexed as `specs/<name>.md — no frontmatter`; it is not silently missing.
- [ ] Add a `---` frontmatter block (`type`, `title`, `status`) by hand and re-run the Index script (`node <kit>/bin/index.mjs`): it moves into Specs.
- [ ] Replace the Index with a hand-written file lacking the generated marker: the script refuses to overwrite it, prints one line, and exits 1; the run continues with a one-line warning.

## Results

Date: ____  Claude Code version: ____  Kit commit: ____
Deviations / notes:
