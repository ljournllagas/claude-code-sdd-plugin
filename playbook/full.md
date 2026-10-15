# SDD team-lead playbook — Lane FULL

Part of the team-lead playbook (`team-lead.md` holds §0–§2, §11 and §12 and says where every other section lives). Read on a FULL run. Execution (§7) is in `execution.md`.

## 4. Lane FULL — spec stage

1. `stage: "spec-draft"`. Immediately before the first analyst dispatch of the run, run `node "<kit>/bin/index.mjs"` (so a project upgraded from an earlier Kit, hand-migrated artifacts and artifacts from other branches are indexed); a non-zero exit is reported in one line and the run continues. Route stage `analyst` (§12.1) and dispatch it (§12.2) with the request text, the spec path `<cfg.paths.specs>/<slug>.md`, the template `<kit>/templates/spec.md`, the triage paths as `Starting paths:` (so it does not rediscover them), the `Spec size:` chosen at triage (§2 step 4), the limit `cfg.limits.openQuestions` and the AC cap `cfg.limits.maxAcceptanceCriteria`. Parse its return (`SPEC: <path>` then `OPEN QUESTIONS`). Record `spec` in the marker (`marker.mjs set spec=<path>`).
2. **Open-question rounds** (at most `limits.questionRounds`). Show the user every question with its recommended answer and wait for answers (the user may accept the recommendations). Re-dispatch the analyst (routed again; card summary "revise per user answers") with the answers; parse the new return. If the analyst returned more than `limits.openQuestions` questions, or blocking questions remain after the last round, show the remaining blocking questions to the user **verbatim** and apply §10 "Analyst questions unanswered". Non-blocking questions the user does not answer stay as assumptions in the spec.
2b. Run `node "<kit>/bin/scope-check.mjs" "<spec>"` as a size gate before review. On any defect, do not continue: show the count and defect verbatim, and apply §2 "Too big for one spec" (name the pieces and a suggested order, then stop); each piece re-enters triage separately. Only when it prints `ok` proceed.
3a. Run `node "<kit>/bin/cite-check.mjs" "<spec>"` as the spec's mechanical gate before review: it checks the frontmatter block and resolves every Background citation, so the reviewer does not. On any defect, re-dispatch the analyst (routed, card summary "revise per citation check") once with the defect lines as `Revise per citation defects: <lines>`, and re-check; only then proceed. Defects here are `spec: invalid frontmatter (…)`, `spec: frontmatter type is …`, `spec: frontmatter has no description`, `spec: unresolved citation`, `spec: citation line out of range` and `spec: Background has no file:line citations`.
3b. `stage: "spec-review"`. Run the review loop (§5) with ARTIFACT = spec (the reviewer prompt carries `Spec size: light` when triage chose it).
4. `stage: "spec-approval"`. Show the spec path and a two-line summary; ask the user to approve. Only on a user message that approves: make the status edit to `approved` immediately and go to §6. If the user asks for changes, set `stage: "spec-draft"` and relay them to the analyst (routed, "revise per user feedback"); then set `stage: "spec-review"` and re-run the review loop (§5, as a new loop); then set `stage: "spec-approval"` and ask again. (The stage tracks the revision so that a lost session never re-asks approval of an unreviewed revision.)

The analyst prompt (§12.2):

**analyst**
```
Write the spec.
Request: <request text>
Spec path: <cfg.paths.specs>/<slug>.md
Template: <kit>/templates/spec.md
Index: <cfg.paths.index>
Starting paths: <the triage paths (§2 step 2), or none>
Spec size: <light | full>                 (§2 step 4)
Open-question limit: <cfg.limits.openQuestions>
AC cap: <cfg.limits.maxAcceptanceCriteria>
[Revise per user answers: <answers>]
[Revise per review findings: record <.sdd/review/…-r<n>.md>; fix only blockers marked "fix"]
[Revise per citation defects: <the defect lines printed by cite-check.mjs>]
[Record this accepted blocker verbatim under Accepted risks: <text>]
[Add to Out of scope: <text>]
```

## 5. Review loop (spec and plan)

Parameters: for the spec, ARTIFACT = `spec`, author = `analyst`, reviewer stage `reviewer-spec`; for the plan, ARTIFACT = `plan`, author = `planner`, reviewer stage `reviewer-plan`. Let R = `limits.reviewRounds`. Only blockers gate; the score is advisory. For the plan the reviewer prompt also carries a `Scope:` line (§12.2); the outline's review and each slice's review is its own loop (a new loop for the round counter), and record numbers continue across them.

Before round 1 of the first loop, make the status edit of the artifact to `in-review`.

**Records and loops.** Review records are numbered `N = 1, 2, 3 …` per artifact across all loops on that artifact and are never overwritten or renumbered. A **loop** is one run of up to R rounds; an artifact's first loop is loop 1. A **new loop** (loop 2, 3 …) starts — round counter k back at 1, record numbers continuing — whenever §4.4/§6 steps 3 and 7 (user-requested changes), §9 (amendment review) or §10 ("Reject as out of scope") re-runs the review. Each record starts with the line `# Loop <j> · round <k> of <R>` (a plan record adds ` · scope outline`, ` · scope slice <n>` or ` · scope plan`) and, once the round is finished (steps 5-6), ends with the line `Exit: clean | stall | cap hit | next round | new loop`. A record with no `Exit:` line (the session was lost between steps 3 and 6) is finished first: triage its blockers if its `## Dispositions` is missing, run the exit check on it (step 5) and, on the next round, step 6 (re-dispatching the author is safe if it had already revised: it finds those blockers fixed), so that the record gets its `Exit:` line before anything else. The **rejected list** is every `rejected:` disposition in every record of the artifact, across all loops. On resume, the highest-numbered record gives the loop and round, and its `Exit:` line says whether to run round k+1 or the loop had already ended.

Each round k of the loop (1 … R), with record number N = the highest existing N + 1 (1 if none):

1. Route (§12.1, stage `reviewer-<ARTIFACT>`) and dispatch the reviewer (§12.2) with `MODE: <ARTIFACT>` and `Round: <k> of <R>`.
2. If the return has neither findings nor a Verdict, it is **did not review**: never a pass. Re-dispatch once; if it is still empty, treat the review as declined, tell the user "<ARTIFACT> unreviewed", go to the approval gate, and write "unreviewed" in the final report.
3. Write `.sdd/review/<slug>-<ARTIFACT>-r<N>.md`: first the line `# Loop <j> · round <k> of <R>`, then the reviewer's report **verbatim**, then a `## Dispositions` section with one line per blocker: `fix` or `rejected: <one-line reason>`. This is a record, not authored analysis.
4. **Triage each blocker yourself** (you were in the conversation; the reviewer was not). A **real gap** → `fix`. A **deliberate choice** — the user cut it, the spec defers it, it is under Out of scope → `rejected: <reason>`. Pushing back is expected; accepting every finding quietly undoes the user's decisions. If a fix needs a decision the user never made, ask the user one question with your recommendation before dispatching the author.
5. **Exit check, in order** — before any revision:
   - Zero blockers, or every blocker rejected (so nothing is sent to the author) → **clean**.
   - This round's blockers match the previous round's **in the same loop** (same defect, same location, even if reworded; the author revised between the two rounds) → **stall**.
   - Round R finished with blockers marked `fix` → **cap hit**. Never run a round R+1 on your own.
   - Otherwise the next round.
   On clean, stall or cap hit, append the result now as the last line of record N: `Exit: clean`, `Exit: stall` or `Exit: cap hit`. On a stall or cap hit the author is **not** re-dispatched: the open blockers go to the user unrevised (§10).
6. **Next round only:** re-dispatch the author for the blockers marked `fix`, routed (card stage `analyst` or `planner`, summary "revise per review findings"), giving it the artifact path and the record path. Pass cheap, obviously correct should-fix items in the same dispatch; carry the rest to the outcome as advisory. When it returns, append `Exit: next round` as the last line of record N.
7. Print one line: `▸ <ARTIFACT> review <k>/<R> — <score>/10, <b> blockers` and, on a second line, `  fixed: … · rejected: …` (on a stall or cap hit, `open:` instead of `fixed:`). Then run round k+1, or follow the exit below.

**Clean:** print `▸ <ARTIFACT> review <k>/<R> — <score>/10, 0 blockers ✅`, list every remaining should-fix verbatim as advisory, and go to the approval gate. A 9 with zero blockers is a success; do not run another round for a higher score.

**Stall or cap hit:** stop. Show the remaining blockers **verbatim**, never summarised, with one line on what was tried, and apply §10 "Review stall or cap hit". Do not continue to the approval gate on your own.

## 6. Lane FULL — plan stage

A split plan is a **manifest** (`<cfg.paths.plans>/<slug>.md`) plus one **task file** per task (`<cfg.paths.plans>/<slug>/T<n>.md`). It is written in pieces, so that a lost session loses at most one task file: an outline first, then the task files of one slice at a time, in batches of `limits.expandBatchTasks`. A slice holds at most `limits.sliceMaxTasks` tasks; a larger plan is cut into slices that are expanded, reviewed, approved and executed one after another. The planner keeps its verified repository facts in `.sdd/<slug>.grounding.md` (written at OUTLINE, read by every EXPAND batch), so later batches do not rediscover them. A **legacy plan** (its frontmatter has no `layout: split`; one file holds every task) follows §14 (`legacy.md`).

1. **Outline.** `stage: "outline-draft"`. Route stage `planner` and dispatch it (§12.2) with `MODE: OUTLINE`, the spec path, the manifest path `<cfg.paths.plans>/<slug>.md`, the templates `<kit>/templates/plan.md` and `<kit>/templates/task.md`, the grounding-notes path, the Verify block (the non-null `cfg.verify` commands; say so in the prompt if `cfg.verify.test` is null), `Slice cap: <limits.sliceMaxTasks>` and `Task file line cap: <limits.maxTaskFileLines>`. Record `plan` (the manifest path) in the marker. Parse `PLAN:`, `TASKS:` and `SLICES:`.
2. If the planner returns `SPEC-GAP: …`, the spec cannot be planned as written: handle it as a spec amendment (§9). Otherwise run `node "<kit>/bin/plan.mjs" check "<manifest>" --outline --spec "<spec>"` (the **outline check**). Exit 1 prints one defect per line: re-dispatch the planner once (routed, "revise: outline defects", `MODE: OUTLINE`, the defect lines in the prompt) and re-run the check; if it still fails, apply §10 "Plan check failed". The reviewer does not re-check what the script checks.
3. **Slices.** With `SLICES: 1` there is no separate outline review or approval: record `slice: {n: 1, total: 1}` and `approved_slices: []` in the marker and go to step 4. With more than one slice: `stage: "outline-review"`, run the review loop (§5) with ARTIFACT = plan and `Scope: outline`; then `stage: "outline-approval"`: show the manifest path, the task count and each slice (title, task count, ACs) and ask the user to approve the slice boundaries. Only on a user message that approves: make the status edit of the plan to `approved`, record `slice: {n: 1, total: <k>}` and `approved_slices: []`, and go to step 4. Requested changes: `stage: "outline-draft"`, relay them to the planner (routed, "revise per user feedback", `MODE: OUTLINE`), re-run the outline check, then `stage: "outline-review"` as a new loop, then ask again.
4. **Expand the current slice.** `stage: "plan-draft"`. Run `node "<kit>/bin/plan.mjs" tasks "<manifest>"`; the pending IDs are the current slice's tasks whose `expanded` is false, in index order. While any remain: route the EXPAND card (§12.1: `--manifest <manifest> --tasks <the batch>`) and dispatch the planner with `MODE: EXPAND`, `Tasks:` = the first `limits.expandBatchTasks` pending IDs, and the spec, manifest, templates, grounding notes, caps and Verify-block lines of step 1. Then run `plan.mjs tasks` again: a task whose file now exists is expanded. An `OUTLINE-GAP: …` in the return is handled as a plan amendment (§9, blocks = `manifest`); a `SPEC-GAP: …` as in step 2. Never re-dispatch an ID whose file exists, and never batch across slices. A dispatch after which none of its IDs is expanded, and that returned no `OUTLINE-GAP` or `SPEC-GAP`, made no progress: do not repeat it; apply §10 "Plan check failed".
5. **Slice check.** Run `node "<kit>/bin/plan.mjs" check "<manifest>" --slice <n> --spec "<spec>" --paths` (a single-slice plan: `--plan`). Besides the manifest and index agreement it checks each task's `Reuse:` line and that every `modify` target exists and every `create` directory exists (or an earlier task creates them). Defects: re-dispatch the planner once (routed, "revise: plan defects", the defect lines in the prompt) and re-check; on a second failure apply §10 "Plan check failed".
6. **Review.** `stage: "plan-review"`. Run the review loop (§5) with ARTIFACT = plan; the reviewer prompt also carries the spec path and `Scope: slice <n>` (`Scope: plan` for a single-slice plan).
7. **Approval.** `stage: "plan-approval"`. Show the plan path, the slice's task count and the coverage summary; ask the user to approve. Only on a user message that approves: for a single-slice plan make the status edit of the plan to `approved` first; add the slice number to `approved_slices` (`marker.mjs push approved_slices <n>`); go to §7 (`execution.md`). Requested changes: set `stage: "plan-draft"` and relay them to the planner (routed, "revise per user feedback"); then set `stage: "plan-review"` and re-run the review loop (§5, as a new loop); then set `stage: "plan-approval"` and ask again (as in §4 step 4).
8. **Next slice.** When §7 has finished every task of slice n and n is less than `total`: set `slice.n` to n + 1 and return to step 4. After the last slice go to §8.

The planner prompt (§12.2):

**planner**
```
Write the plan.
MODE: <OUTLINE | EXPAND>                  (omit for an amendment, fix tasks or a legacy plan)
Spec: <spec path>
Plan path: <cfg.paths.plans>/<slug>.md
Template: <kit>/templates/plan.md
Task template: <kit>/templates/task.md
Grounding notes: .sdd/<slug>.grounding.md
Slice cap: <cfg.limits.sliceMaxTasks>
Task file line cap: <cfg.limits.maxTaskFileLines>
[Tasks: <T-ids>]                          (EXPAND only)
Verify block:
- <key>: `<command>`   (non-null commands only)
[No test command is configured: apply the Check:/Manual: rules.]
[Revise per review findings: record <path>; fix only blockers marked "fix"]
[Revise per mechanical check: <the defect lines printed by plan.mjs check>]
[Amendment: <fix tasks to append / tasks to replace and the finding they answer>]
[Record this accepted blocker verbatim under Accepted risks: <text>]
```

## 8. Post-execution review (FULL)

1. `stage: "code-review"`. Build the **run diff** over the FULL run paths (§12.4) and route stage `reviewer-code`. Dispatch the reviewer with `MODE: code`, the diff (or file-list) path, `Spec:` and `Plan:` (so it can check the change against what was asked), `Red unproven:` with the IDs of the done tasks that have a `Red:` line and no `red_proven` in the marker (§7.3 step 6; omit the line when there are none), `LENSES:` = the union of the decision's `lens[]` and every task's declared Lenses, and as previously rejected findings every `rejected:` disposition in the earlier code-review records. A return with neither findings nor a Verdict is *did not review* (the §5 step 2 rule): re-dispatch once; if it is still empty, write no record, note "unreviewed" for the report and go to §11. Otherwise write the record `.sdd/review/<slug>-code-r<N>.md` (N = 1, 2, … in order: record 1 is the first review, record 1+f follows f fix rounds) (the reviewer's whole return, copied unchanged from its `## Review —` line and never summarised or reworded, then a disposition per blocker: `fix` or `rejected: <reason>`, triaged as in §5 step 4).
2. No blockers marked `fix` → go to §11. Blockers marked `fix` in record N where N is greater than `limits.reviewFixRounds` (that many fix rounds already ran) → §10 "Review-fix cap reached".
3. Otherwise `stage: "review-fix"`. This is fix round f of at most `limits.reviewFixRounds`, where f = the number of the code-review record whose blockers are being fixed. Dispatch the planner (routed, card stage `planner`, summary "write fix tasks for review findings") with the record path to append **fix tasks** to the plan. Fix tasks are plan amendments: apply §9 (reviewer checks the amended blocks, the user approves the amendment), then execute them with §7.3 — each is re-verified like any task, with the pre-flight re-run for its Files list (§9).
4. After the fix tasks complete, run the code review again (step 1, record N+1).
