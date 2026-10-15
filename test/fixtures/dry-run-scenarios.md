# SDD dry-run scenarios (walk once per Kit release on the real harness)

Setup for every scenario: copy `test/fixtures/repo-js` (or `repo-py`) to a fresh temp directory, `git init` it and make one commit (except Scenario 6), start Claude Code there with the Kit loaded (`claude --plugin-dir <path to sdd>`; headless, type `/sdd:sdd` for `/sdd`), run `/sdd-init`, accept the detected commands, and write `{"router": {"enabled": false}}` merged into `sdd.config.json` so routing uses the built-in table (a stubbed router; real TypeSafe is exercised by `test/route.test.mjs`). Tick each line only when you saw it happen. Record the date, Claude Code version and any deviation at the bottom.

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

Start from a run already at `executing`, so no agent sees the trap while planning (in a three-file repo the analyst and planner read every file and raise it as a `SPEC-GAP`). Copy `repo-js`, overlay `test/fixtures/ff-escalation/` (an approved spec, a one-task split plan, and `api.test.js`, an export snapshot that passes now and fails once `shout` is exported), `git init` and commit. Write `sdd.config.json` with `verify.test` `npm test`, `testOne` `npm test -- {target}`, `router.enabled` false and `limits.verifyFailuresPerTier` 1. Then `marker.mjs init demo-shout FULL`; `marker.mjs set spec=docs/sdd/specs/demo-shout.md plan=docs/sdd/plans/demo-shout.md 'slice={"n":1,"total":1}' 'approved_slices=[1]' stage=executing`; `marker.mjs baseline`; and run `/sdd` to resume. The developer's Green runs only `greet.test.js`; the team-lead's Verify (`npm test`) fails on `api.test.js`. A retry developer may judge the snapshot to contradict the task and return `TASK-BLOCKED: design-gap` (the amendment path, §9): record which path the run took.
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

## Scenario 10 — Cutoff during task expansion (v0.3)

Set `limits.expandBatchTasks` to 2 in `sdd.config.json`. Run `/sdd` with a FULL request that yields at least five tasks (repo-js: a small module with a CLI wrapper, a formatter and a report command).
- [ ] After the spec is approved the planner is dispatched with `MODE: OUTLINE` and writes only `docs/sdd/plans/<slug>.md` (no `<slug>/` task folder yet); `plan.mjs check <manifest> --outline` prints `ok`.
- [ ] Each following planner dispatch is `MODE: EXPAND` with at most two task IDs; `docs/sdd/plans/<slug>/T1.md`, `T2.md` appear one by one.
- [ ] Close the session after `T1.md` and `T2.md` exist and before `T3.md`. Reopen Claude Code in the project and run `/sdd`: the marker `stage` is `plan-draft`, the team-lead offers to resume.
- [ ] On resume no planner dispatch names `T1` or `T2`, and the manifest is not rewritten (its modification time is unchanged); the next EXPAND names `T3` (and `T4`).
- [ ] `/sdd-status` shows `slice 1/1 · task 0/<n> (<k> expanded)` with `<k>` counting the files that exist.

## Scenario 11 — Size gate and slices (v0.3)

Set `limits.sliceMaxTasks` to 2 and `limits.expandBatchTasks` to 1. Run `/sdd` with a FULL request that yields four or five tasks.
- [ ] The outline lists at least two slices, each with at most two tasks, dependencies only on the same or earlier slices; the session stops at `outline-approval` and shows the slices (title, task count, ACs). Saying nothing does not advance it.
- [ ] After you approve: plan `status:` is `approved`; marker has `slice: {n: 1, total: <k>}` and `approved_slices: []`; only slice 1's task files exist.
- [ ] Slice 1 is reviewed with a reviewer prompt carrying `Scope: slice 1`, then the session stops at `plan-approval`; approving records `1` in `approved_slices`.
- [ ] Only slice 1's tasks execute (each with a fresh developer given `Task file: <path>`), each `[x] done` in its own task file, one commit per task.
- [ ] The team-lead then moves to slice 2: `stage` returns to `plan-draft`, slice 2's task files are expanded, reviewed and approved separately; no slice 2 task runs before that approval.
- [ ] The single final `code` review runs after the last slice; plan `status: done`; marker deleted.

## Scenario 12 — Legacy single-file plan (v0.3)

In a project, put a plan written by v0.2 (frontmatter without `layout`, all tasks in one file, some marked `[x] done`) at `docs/sdd/plans/<slug>.md` and a marker `.sdd/active.json` with `stage: "executing"`, no `slice`, `plan` pointing at it.
- [ ] `/sdd` offers to resume and continues at the next pending task exactly as v0.2 did: no outline stage, no `MODE:` line in any planner dispatch, developer prompts carry `Plan:` and `Task:`.
- [ ] `/sdd-status` prints `task <done>/<total>` with no `slice` and no `expanded` text.
- [ ] `node <kit>/bin/plan.mjs check docs/sdd/plans/<slug>.md --plan` prints `ok` (or the Task count / Verify defects, never a layout error).

## Scenario 13 — Outcome lines

Set `limits.verifyFailuresPerTier` to 1 and make one task's verify fail once (for example a test that fails on the first run only, through a marker file the test creates). Run a small FULL request with three tasks. After each step, read `.sdd/decisions.jsonl` (lines with `"kind":"outcome"`) and `.sdd/active.json`.
- [ ] Before a task is dispatched, its `tasks[<id>]` entry has `attempt_tier` and `routed` (`{source, reason}` of the decision just returned); no other new key is present.
- [ ] The failing task: after the failed verify, one `outcome.mjs` line with `result: "fail"` and `first_attempt: true` was appended after the failure file was written and before the retry was routed; no duplicate appears after the retry is dispatched.
- [ ] The retry that passes: one line with `result: "pass"`, `first_attempt: false`, `source: "escalation"` (or the router's retry reason), whose `tier` equals the entry's `attempt_tier`.
- [ ] A task that passes at once: `first_attempt: true`, `result: "pass"`, `source` and `reason` equal to the matching decision line; `duration_ms` and `agent_tokens` are numbers (or null if the dispatch result had no `<usage>` block).
- [ ] `/sdd-status` prints an `Outcomes:` block whose first-attempt ratio counts only the `first_attempt: true` pass and fail lines.
- [ ] Cut the session (close the window) after the failure file exists and before the retry is dispatched; resume with `/sdd`. Exactly one `fail` line exists for that attempt, and the retry's line has `first_attempt: false`.
- [ ] Make a task hit `TASK-BLOCKED: design-gap`: one line with `result: "blocked"` was appended before the amendment began, and the replaced task's next line has `first_attempt: true`.
- [ ] Exhaust a task at `deep` so the session stops with **Task needs a human**, choose **I fixed it** and let its Verify pass: no outcome line is written for that verify, and `/sdd-status`'s counts do not change.
- [ ] A `Manual:` task (unset `verify.test` first): answering **Confirm done** or **Not done** writes no outcome line.
- [ ] Resume at `quick-review` in a QUICK run after a cut: the pass line already written is not duplicated.

## Scenario 14 — Token savings and script bookkeeping (v0.6)

Run one QUICK request (Scenario 1) and one FULL request with two tasks (Scenario 2). Watch the team-lead's tool calls.
- [ ] QUICK: the team-lead read `playbook/team-lead.md`, `quick.md` and `execution.md` only; `full.md`, `stops.md`, `amendments.md`, `resume.md` and `legacy.md` were never opened. FULL: `full.md` and `execution.md` were read once each.
- [ ] The marker was only ever changed through `bin/marker.mjs` (no Write or Edit of `.sdd/active.json`); every developer dispatch was routed with `bin/card.mjs … --record <key>` and no `.sdd/card.json` was written.
- [ ] Every verify ran through `bin/verify.mjs` and printed one line; no test-runner output appeared in the main session. A failing verify wrote `.sdd/review/<slug>-<task>.fail.txt` (at most 40 lines).
- [ ] Each FULL task finished with one `bin/task-done.mjs` call: heading `[x] done`, one commit with only the task's files, one `pass` outcome line. Leave a stray file in the tree before a task finishes: the call exits 3 listing it, nothing is committed, and after **Keep** the same call commits.
- [ ] The analyst prompt carried `Starting paths:`, `Spec size:` and `AC cap:`; a small request got a light spec. The planner prompt carried `Grounding notes:` and `Task file line cap:`, and `.sdd/<slug>.grounding.md` existed after the outline and was read by each EXPAND batch.
- [ ] Each developer prompt carried a `Runner:` line; the developer did not run the full test suite (its report says `Verify: … left to the team-lead` for the `test` command). Its `Red:` and `Green:` runs used `--expect-tests`.
- [ ] After each `TASK-DONE` whose `Red:` line reads `→ failed:`, the marker has `tasks.<id>.red_proven: true`. Any done task with a `Red:` line and no `red_proven` appears on the code reviewer's `Red unproven:` line.
- [ ] The final `code` reviewer prompt carried `Spec:` and `Plan:` (FULL) or `Goal:` (QUICK), and the decision log shows the `reviewer-code` stage at `standard` or above.
- [ ] Resume a run after closing the window: `bin/doctor.mjs` ran first and its `issues:` lines (if any) were shown; then `resume.md` was read.

## Results

Date: ____  Claude Code version: ____  Kit commit: ____
Deviations / notes:

### 2026-10-15 · Claude Code 2.1.300 · Kit 0.6.7 (5fae0a8)

Run headless (`claude -p --plugin-dir`, approvals given as follow-up turns), repo-js, router disabled. Team-lead on the session default model; agents on the tiers the router chose.

- **Scenario 1 (QUICK):** pass. Triage stopped with a `▸ triage:` line and no agent; marker `lane: QUICK`, `base` = HEAD, `dirty_at_start` empty; developer at standard → sonnet, `source: "fallback"`; team-lead ran the verify set; code review record written; nothing committed; marker deleted; `/sdd-status` showed 3 delegations and the outcome. Deviations: the developer ran the full `npm test` as its Green instead of narrowing (the QUICK brief does not carry `testOne`); the team-lead's review record paraphrased the review instead of quoting it.
- **Scenario 2 (FULL):** pass. Raised from QUICK to FULL; spec with open questions and recommendations; spec review fixed a blocker in round 1; stops at spec and plan approval; 3 tasks, each a fresh developer, team-lead Verify, `[x] done`, one commit with only its files; final code review; plan `status: done`; marker deleted. Guard: a second session asked to Edit `greet.js` during the run was refused with the `SDD guard:` message. Deviation: the team-lead recorded `base` and `dirty_at_start` at triage instead of in §7.1 (no effect in this run).
- **Scenario 3 (risk floor):** pass. FULL with the `schema` flag; "do it as QUICK" refused with FULL / Rescope / Abort.
- **Scenario 5 (escalation):** pass after a setup change. The planner avoided the always-failing `verify.test` by using `npm test -- greet.test.js` in the task's Verify line; the user had to require the configured command. Then: fail at standard → failure file → FF dispatch at deep naming the failure file and edited paths, `source: "escalation"` → `TASK-BLOCKED: environment` → `human` stop with exactly I fixed it / Retry at deep with guidance / Skip / Abort → **Skip** listed leftovers with Keep / Revert and restored nothing. No dependent tasks, so the `[!] blocked` line was not exercised. Deviation: the team-lead added a free-form `Note:` line to the FF dispatch, outside the §12.2 template.
- **Scenario 14 (partial, from runs 1 and 2):** playbook reads as specified (QUICK: team-lead, quick, execution; FULL: full and execution once each); marker only changed through `marker.mjs` (deleted with `rm` at the end); every verify through `verify.mjs`; analyst prompts carried `Starting paths:`, `Spec size: light`, `AC cap:`; planner prompts carried `Grounding notes:` and `Task file line cap:`, grounding file present; developers used `--expect-tests` for Red and Green and left `npm test` to the team-lead; `red_proven: true` set after each Red failure and kept on the FF retry; the code reviewer got `Spec:` and `Plan:` and no `Red unproven:` line (none unproven). Not exercised: the stray-file exit 3, resume.
- **Across runs:** bare `/sdd` did not resolve in headless mode (the commands are `sdd:sdd`, `sdd:sdd-init`, `sdd:sdd-status`; `/sdd-init` did resolve); developer reports sometimes listed absolute paths in `Files changed/created`; no developer ran the step-6 `git diff` review (each compared `git status` only); `effort` was passed in runs 1 and 2 but not in run 5.
- **Not run:** Scenarios 4, 6–13.

### 2026-10-15 · Claude Code 2.1.300 · Kit 0.6.8 re-run, then 0.6.9 check

- **Scenario 1 (0.6.8):** pass. The brief carried `Narrow tests:` and Green used it; paths relative; review record verbatim. Deviations: the developer also ran the whole `npm test` (the brief's Runner line was filled with it); it reported `Diff review: git diff read` without running `git diff`.
- **Scenario 5 (0.6.8, planted failing test):** `plan.mjs check` held the task's Verify to `npm test`. The analyst and planner noticed the planted failure and wrote a Verify *expected* to fail; the plan reviewer accepted it. After the first failed verify the team-lead did not dispatch the routed retry: it invented a five-option stop. The developer again reported `Diff review: git diff read` without running it.
- **Scenario 6 (QUICK half, 0.6.8):** pass. Marker `base: none`, `dirty_at_start: []`; no git command run; the reviewer got `.sdd/review/<slug>.files`. Deviation: the developer ran the whole `npm test`. FULL half not run.
- **Scenario 1 (0.6.9):** pass. The developer ran only the narrowed tests and left `npm test` to the team-lead; no unbacked review claim. Still open: the developer's closing command was `git status` without `git diff` (third run in a row).

### 2026-10-15 · Claude Code 2.1.300 · Kit 0.6.11 and 0.6.12, Scenario 5

- **0.6.11, planted lint rule:** the suite check ran right after lane confirmation and passed; the planner read `scripts/lint.mjs` and returned `SPEC-GAP`. The team-lead asked the user with its own options and recorded neither a stop nor an amendment (led to the 0.6.12 "Spec gap" stop). A tiny repo cannot hide a trap from planning, which led to the `ff-escalation` fixture.
- **0.6.12, `ff-escalation` fixture (resumed at `executing`):** first attempt at standard → `TASK-DONE` with Red proven → team-lead Verify failed on `api.test.js` → failure file → FF dispatch at deep, template-only, `source: "escalation"` → `TASK-BLOCKED: design-gap` (snapshot outside Files) → `[!] blocked`, outcome lines `fail` (first attempt) then `blocked`, stop **Leftover edits** recorded in the marker. The "Task needs a human" stop was not reached (design-gap path). Deviations: `red_proven` was not set after the first `TASK-DONE`; the deep developer wrapped its report in prose and a code fence.

- **0.6.13 check (same fixture without `api.test.js`, resumed at `executing`):** pass. `red_proven` set in the step-5 command (`set tasks.T1.in_progress=false tasks.T1.red_proven=true`); the developer returned the plain report block; one commit with only T1's files; the code reviewer got `Spec:` and `Plan:` and no `Red unproven:` line; marker deleted.
