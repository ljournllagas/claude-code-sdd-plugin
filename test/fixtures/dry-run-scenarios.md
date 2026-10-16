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
- [ ] Triage proposes FULL (or you raise it) and states the `files_touched` estimate and the spec size (`light` only for an estimate of 5 or fewer); you confirm.
- [ ] Analyst writes `docs/sdd/specs/<slug>.md` with every template heading; open questions are shown to you with recommendations; you answer; the spec is revised.
- [ ] Spec review runs (round lines `▸ spec review n/3 …`, the denominator is always `limits.reviewRounds`, also when the loop ends at round 2), exits clean or you resolve it; the session **stops** and asks for approval; saying nothing does not advance it.
- [ ] After you approve, the spec's `status:` is `approved` and the planner writes `docs/sdd/plans/<slug>.md`; plan review runs; the session stops for plan approval.
- [ ] After approval: plan `status: executing`; marker `base` is set once; each task: marker `in_progress` true then false, a fresh developer, the team-lead runs the Verify, the task heading becomes `[x] done`, a commit containing only that task's files.
- [ ] One final `code` review over the run diff; report lists tasks, commits, routing summary; plan `status: done`; marker deleted.

## Scenario 3 — Risk-floor refusal

Run: `/sdd rename the column "email" in the users table migration` (any repo; create `db/migrations/001_init.sql` first).
- [ ] Triage shows FULL with the signal named (a `schema` risk flag, or a `riskKeywords` match under the stubbed router).
- [ ] Reply "do it as QUICK": the team-lead refuses, states the signal again, and offers FULL / rescope / abort. It does not proceed as QUICK.

## Scenario 4 — Review stall

Make the reviewer find a blocker that the author cannot fix: after the spec is drafted, edit the spec by hand to add the contradictory requirement "AC-2: the output must be both empty and non-empty" (or ask the analyst for something impossible).
- [ ] After round 1 the team-lead runs round 2 without stopping or asking (it never judges the author's fix itself). The same blocker is reported in two consecutive rounds; the loop exits as **stall** (not cap hit) before round 3. To make the author unable to fix it, keep a watcher script that re-adds the line to the spec after every analyst revision (write its log outside the project).
- [ ] The remaining blocker is shown verbatim and the options offered are exactly Direct / Accept / Reject as out of scope / Abort.
- [ ] Choose **Accept**: the blocker appears under `Accepted risks` in the spec character for character as in the record's Blockers section (no added words) and the flow reaches the approval gate (it does not skip it).

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
- [ ] Delete the `Reuse:` line from one task by hand and ask for the plan review again: the team-lead's `plan.mjs check` stops first with `T<n>: no Reuse: line (or an empty one)` and no reviewer is dispatched (the mechanical check owns this defect; the reviewer is not asked to find it).
- [ ] Replace the Recipe of one task with one that reimplements the existing helper: the reviewer reports it as a should-fix (or a blocker only if it cites the existing symbol by path and it does the identical thing; with a `Reuse:` line that names the helper, a Recipe that contradicts it is a blocker).

## Scenario 8 — Index read by the analyst (v0.2)

In a project with an approved spec in `docs/sdd/specs/` (frontmatter present), run `/sdd` with a request that really overlaps it: copy `test/fixtures/ff-escalation/docs/sdd/specs/demo-shout.md` there and ask for `shout(name)` plus a CLI. (A sibling such as `whisper` does not overlap, and the analyst correctly raises no overlap question.)
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
- [ ] `/sdd` offers to resume and continues at the next pending task exactly as v0.2 did: no outline stage, no `MODE:` line in any planner dispatch, developer prompts carry `Plan:` and `Task:`. The code reviewer's prompt has no `Red unproven:` line for a task that was `[x] done` before the run (it has no `tasks` entry in the marker).
- [ ] `/sdd-status` prints `task <done>/<total>` with no `slice` and no `expanded` text.
- [ ] `node <kit>/bin/plan.mjs check docs/sdd/plans/<slug>.md --plan` prints `ok` (or the Task count / Verify defects, never a layout error).

## Scenario 13 — Outcome lines

Set `limits.verifyFailuresPerTier` to 1 and make one task's verify fail once (for example a test that fails on the first run only, through a marker file the test creates). Run a small FULL request with three tasks. After each step, read `.sdd/decisions.jsonl` (lines with `"kind":"outcome"`) and `.sdd/active.json`.
- [ ] Before a task is dispatched, its `tasks[<id>]` entry has `attempt_tier` and `routed` (`{source, reason}` of the decision just returned); no other new key is present.
- [ ] The failing task: after the failed verify, one `outcome.mjs` line with `result: "fail"` and `first_attempt: true` was appended after the failure file was written and before the retry was routed; no duplicate appears after the retry is dispatched.
- [ ] The retry that passes: one line with `result: "pass"`, `first_attempt: false`, `source: "escalation"` (or the router's retry reason), whose `tier` equals the entry's `attempt_tier`.
- [ ] A task that passes at once: `first_attempt: true`, `result: "pass"`, `source` and `reason` equal to the matching decision line; `duration_ms` and `agent_tokens` are numbers (or null if the dispatch result had no `<usage>` block).
- [ ] `/sdd-status` prints an `Outcomes:` block whose first-attempt ratio counts only the `first_attempt: true` pass and fail lines.
- [ ] Cut the session (kill the process) right after the `fail` line is appended; resume with `/sdd`. Exactly one `fail` line exists for that attempt, and the retry's line has `first_attempt: false`. (A cut earlier, between the failure file and the `fail` line, writes no `fail` line at all on resume, by the "never write a line for a verdict reached before the cut" rule of §7.3.)
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
- [ ] Each developer prompt carried a `Runner:` line; the developer did not run the full test suite (its report says `Verify: … left to the team-lead` for the `test` command): with `testOne` configured every pending task's `Red:` and `Green:` use the targeted command (`plan.mjs check` rejects the full `test` command there). Its `Red:` and `Green:` runs used `--expect-tests`.
- [ ] After each `TASK-DONE` whose `Red:` line reads `→ failed:`, the marker has `tasks.<id>.red_proven: true`. Any done task with a `Red:` line and no `red_proven` appears on the code reviewer's `Red unproven:` line.
- [ ] The final `code` reviewer prompt carried `Spec:` and `Plan:` (FULL) or `Goal:` (QUICK), and the decision log shows the `reviewer-code` stage at `standard` or above.
- [ ] Resume a run after closing the window: `bin/doctor.mjs` ran first and its `issues:` lines (if any) were shown; the team-lead asked "Resume <slug> at <stage>?" and waited; then `resume.md` was read.
- [ ] Every spec or plan `status:` change went through `bin/status-edit.mjs` (no Edit or `sed` of a frontmatter), one `status <file>: <old> → <new>` line each, and the Index was refreshed by it.

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

### 2026-10-15 · Claude Code 2.1.301 · Kit 0.6.13 (3f28d3b), Scenarios 4, 6 (FULL), 7–14

Run headless (`claude -p --plugin-dir`, `--model sonnet` for the team-lead, approvals as follow-up turns in the same session), `router.enabled` false. Setup deviation: `sdd.config.json` was written directly (verify `test` `npm test`, `testOne` `npm test -- {target}`) instead of running `/sdd-init`, except in Scenario 9. A cut was made by killing the `claude` process from a watcher script and resuming in a new session with `/sdd:sdd`.

- **Scenario 4 (review stall): reached only with a nudge.** A watcher re-added `AC-99` ("both empty and non-empty") to the spec after each analyst revision. Round 1 reported it; the analyst removed it, the watcher put it back; the team-lead then **stopped on its own after round 1** (it could not tell what kept writing the line) with its own options (Delete / Keep / Abort) and no round 2. After "run round 2 now": the same blocker came back, `Exit: stall` was written on record 2 (before round 3), and the stop offered exactly Direct / Accept / Reject as out of scope / Abort. **Accept:** the blocker is under `## Accepted risks` and the flow reached the spec-approval gate. Deviation: the Accepted risks text is not the reviewer's blocker verbatim (the team-lead's `Record this accepted blocker verbatim` line had extra wording that is not in the review record). A second attempt where the user made `AC-99` mandatory ended in the team-lead rejecting the blocker as a deliberate user choice (§5 step 4), so no stall.
- **Scenario 6, FULL half:** pass. `baseline --base` printed `base: none`, `dirty_at_start: 0`; `task-done` printed `no commit (not a git repository)` three times; the reviewer got `.sdd/review/<slug>.files`; no `git` command was run; the final report says no commits were made (the team-lead did not say so earlier in the run).
- **Scenario 7 (reuse check):** pass with a scenario change. Every task had a `Reuse:` line and T1 names `greet` (`greet.js:1`). With `Reuse:` deleted from T2 the team-lead ran `plan.mjs check` before the reviewer and stopped on `T2: no Reuse: line (or an empty one)`, so the reviewer-blocker bullet cannot be observed; the mechanical check catches it first. With T1's Recipe rewritten to rebuild the `Hello, ` string, the reviewer reported a **blocker** (it cites the existing symbol and the identical behaviour, so the scenario's blocker exception applies).
- **Scenario 8 (Index read by the analyst):** pass. The Index was regenerated in the same command that routed the analyst, before the dispatch; the prompt carried `Index:`; the analyst opened only the related spec and did not touch the Index; after the run the Index shows the new spec `approved` and the plan `done`, and no leftover-edit stop mentioned it. The first request (`whisper`, a sibling of the earlier `shout` spec) did not overlap, and the analyst cited the earlier spec in Background without an open question; a request that duplicates it (`shout` plus a CLI) produced open question 1 "Overlap with demo-shout" with a recommendation. The scenario's example request should be one that really overlaps.
- **Scenario 9 (unindexed legacy artifact):** pass. `/sdd-init` produced the Index with `specs/old-feature.md — no frontmatter` under Unindexed; after adding frontmatter `index.mjs` moved it to Specs; a hand-written Index made the script print one line and exit 1, and a real `/sdd` request then ran on with a one-line warning ("not generated by the script, so it wasn't overwritten").
- **Scenario 10 (cutoff during expansion):** pass. `limits.expandBatchTasks` 2, six tasks: OUTLINE wrote only the manifest, `plan.mjs check --outline` printed `ok`, then EXPAND batches of two. Killed the process when `T2.md` existed and `T3.md` did not; the marker stage was `plan-draft`. A new session ran `/sdd` and resumed **without asking** (§1 step 4 says to offer); it ran `doctor.mjs` first, dispatched EXPAND for `T3,T4` and `T5,T6` only, and the manifest was not rewritten until the plan-review status edit. `/sdd-status` printed `slice 1/1 · task 0/6 (6 expanded)`. Deviations: `limits.reviewRounds` was 3 but the status line read `spec review 2/2`; in the 8-task run the team-lead chose `Spec size: light` for an estimate of about 6 files (the rule is light only up to 5); two Edit calls were no-ops (old string equal to new) and one targeted a file named `placeholder`.
- **Scenario 11 (size gate and slices):** pass. `sliceMaxTasks` 2, `expandBatchTasks` 1: four tasks in two slices; the first outline failed the check (T3 and T4 summaries over 500 characters), was revised once and passed; stop at `outline-approval` with the slices shown; after approval `slice {n:1,total:2}`, `approved_slices []`, only T1 and T2 expanded one at a time; reviewer prompts carried `Scope: outline`, `Scope: slice 1` (three rounds), `Scope: slice 2`; `approved_slices` got 1 then 2; developers got `Task file:`; `slice.n=2 stage=plan-draft` after slice 1; one final `code` review; plan `done`, marker deleted.
- **Scenario 12 (legacy plan):** pass. `/sdd` offered to resume; developer prompts carried `Plan:` and `Task:`; no `MODE:` line and no outline stage; `/sdd-status` showed `task 1/3` with no slice text; `plan.mjs check --plan` printed `ok`. Note: the done task T1 (committed before the run) reached the code reviewer as `Red unproven: T1`, which the reviewer raised as a blocker and the team-lead rejected.
- **Scenario 13 (outcome lines):** pass for what was run. A test that fails once under the team-lead's `verify.mjs --manifest` call (the first full run, with `verifyFailuresPerTier` 1): `fail` with `first_attempt: true` (standard) written after the failure file, then the retry routed with `source: "escalation"` (deep) and one `pass` with `first_attempt: false`, tier equal to `attempt_tier`; tasks that passed at once have `first_attempt: true`, `fallback`/`disabled` equal to the decision line and numeric `duration_ms`/`agent_tokens`; `/sdd-status` printed `Outcomes: 4 attempts · pass 3 · fail 1`, `first attempt: 2/3`. **Cut** right after the `fail` line was written: the marker already held the escalated route (`attempt_tier` deep, `last_tier` deep, `in_progress` true); the resumed session re-dispatched at deep, and the log has exactly one `fail` and one `pass` with `first_attempt: false`. `ff-escalation` fixture: `fail` (standard), `blocked` (deep, `TASK-BLOCKED: design-gap`) written before the amendment, then after the amendment the replaced T1's line has `first_attempt: true`. A committed always-failing test: `fail`, escalation to deep, `TASK-BLOCKED: environment` (`fail`, `first_attempt: false`), `human: true`, stop with exactly I fixed it / Retry at deep with guidance / Skip / Abort; after the fix and **I fixed it** the task passed with no new outcome line and the `/sdd-status` counts did not change. QUICK with `verify.test` null: stop at "Verify set empty", **Confirm done** wrote no outcome line. QUICK cut at `quick-review` (after the `pass` line): resumed, one `pass` line, no duplicate. Not run: **Not done** on an empty verify set or a `Manual:` FULL task; a cut between the failure file and the `fail` line.
- **Scenario 14 (token savings), the rest:** QUICK read `team-lead.md`, `quick.md`, `execution.md` (plus `resume.md` on a resumed run, `stops.md` at its first stop); FULL read `full.md` and `execution.md` once each; the marker was never written by hand and no `.sdd/card.json` appeared; every verify went through `verify.mjs`. A stray file created while T1 ran: `task-done.mjs` exited 3 with a `leftover:` line, nothing was committed, and after **Keep** the same call committed only T1's files. Resume runs started with `doctor.mjs`. **Fails the bullet "the developer did not run the full test suite":** in four of six FULL runs the planner wrote `Red:` and `Green:` as the full `npm test` although `testOne` was configured (it used `testOne` in the other two), so developers ran the whole suite through `verify.mjs --expect-tests`.
- **Across runs:** the team-lead set the plan's final `status: done` with `sed` in three runs instead of the single anchored Edit; a headless `Agent` call with `run_in_background: false` was backgrounded by the harness in some EXPAND dispatches and the team-lead waited for it; `effort` was passed on some dispatches and not on others.

### 2026-10-15 · Claude Code 2.1.301 · Kit 0.6.14 (9428c92), re-run to confirm the 0.6.13 findings

Same headless setup as the 0.6.13 run (team-lead on sonnet, router disabled, config written directly).

- **Scenario 4 (review stall): pass.** With the same watcher re-adding `AC-99` after each analyst revision, the team-lead ran round 2 on its own (no stop after round 1; it noted the reviewer decides), the loop ended `Exit: stall` on record 2 before round 3, and the stop offered exactly Direct / Accept / Reject as out of scope / Abort. After **Accept** the `## Accepted risks` entry is the record's Blockers bullet character for character, and the flow stopped at the spec-approval gate.
- **Scenario 2/6 (FULL, three tasks): pass.** Every status change (spec `in-review`, `approved`; plan `in-review`, `approved`, `executing`, `done`) went through `status-edit.mjs`; no Edit or `sed` of a frontmatter. The review line read `1/3`. All three tasks' `Red:` and `Green:` were `npm test -- <file>` and the developers ran only those; three commits, one per task, plan `done`, marker deleted.
- **Scenario 10 (about 6 files): pass.** Triage stated the estimate (6) and `Spec size: full`; the spec review read `1/3` then `2/3`; the nine-task plan used `npm test -- <file>` for every `Red:` and `Green:`.
- **Scenario 12 (legacy plan): pass.** `/sdd` asked "Resume legacy-demo at executing?" and waited; after yes it ran T2 and T3, the code reviewer's prompt had no `Red unproven:` line, and the plan went to `done` through `status-edit.mjs`.
- **Scenario 14 (testOne for Red/Green), resume ask: confirmed** by the runs above. Still not run: **Not done** on an empty verify set or a `Manual:` FULL task, and a cut between the failure file and the `fail` line.

### 2026-10-16 · Claude Code 2.1.301 · Kit 0.6.14 (4de5281) → 0.6.15, remaining Scenario 13 / 14 items

- **Verify set empty (QUICK), Confirm done and Not done: pass.** With every `verify` command null, the stop appeared with Confirm done / Not done; **Not done** with a reason led to a second developer dispatch (same tier, `source: "escalation"`) and a second stop; **Confirm done** went to the review. The decision log has no outcome line for either answer and `/sdd-status` showed no outcomes.
- **`Manual:` FULL task, Not done: pass after a playbook change.** The failure file held the user's reason verbatim and no outcome line was written for the answer. On 0.6.14 the team-lead then compared the verdict with the file (my reason was wrong: the README had a title), rejected it and stopped with three options of its own; 0.6.15 (§10: the verdict stands, go straight to the retry) dispatched the deep retry at once with a valid reason. The developer's own `TASK-BLOCKED: design-gap` (a second example the task forbids) wrote the only outcome line (`blocked`, `first_attempt: false`). Gap: the team-lead asked without reading `stops.md` and used its own wording ("reply done"); 0.6.15 adds the pointer in the file table, not re-run.
- **Cut between the failure file and the `fail` line: pass.** Killed the process as soon as `.sdd/review/<slug>-T1.fail.txt` appeared (marker: `attempt_tier` standard, no `last_tier`). The new session asked to resume, then ran step 8 in full: the log has no `fail` line for that attempt (by the rule of §7.3), the escalated retry (deep, `source: "escalation"`) has one `pass` with `first_attempt: false`, and T2 and T3 each have one `pass` with `first_attempt: true`.
