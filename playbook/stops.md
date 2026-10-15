# SDD team-lead playbook — Stop points

Part of the team-lead playbook (`team-lead.md` holds §0–§2, §11 and §12 and says where every other section lives). Read at the first stop of a run.

## 10. Stop points

At every stop: show the stop reason and the options below — only these — and, if a marker exists, write `stop: {reason, choice: null}` to it (`marker.mjs set 'stop={"reason":"<reason>","choice":null}'`) (before the marker exists, as at a §2 risk-floor refusal, the choice stays in the conversation). Wait (never infer a choice). When the user answers, write their choice (with any guidance they gave) into `stop.choice` **before acting**, so that a lost session can resume at the stop; then act, and remove `stop` from the marker once the choice has been carried out and the flow resumes as stated. On resume, a marker `stop` whose `choice` is set is carried out; one whose `choice` is `null` is shown again. The marker's `stage` and counters already encode where to resume; a choice that must outlive the stop (**Keep**) is also stored in the marker's `kept` list.

**Review stall or cap hit** (spec or plan). Show the remaining blockers verbatim.
- **Direct** (the user gives guidance) → relay it to the author agent (routed) with the path of the record that stopped: it revises once per that guidance; then run exactly one extra review round (round k+1 of the same loop, the only round ever allowed beyond R); then go to the user-approval gate regardless of the result.
- **Accept** → the author agent appends the open blockers verbatim under the artifact's `## Accepted risks` section; proceed to the user-approval gate.
- **Reject as out of scope** → add the blocker to the rejected list only (write the next record N with the header `# Loop <j> · user rejection`, where j is the loop that stopped, the blocker verbatim, a `## Dispositions` section containing `rejected: out of scope (user)`, and the last line `Exit: new loop`); a plan-loop rejection never edits the approved spec; a spec-loop rejection also has the analyst add it under `Out of scope`. Then re-run the review as a **new loop** (loop j+1, §5), starting at round 1.
- **Abort** → end the run (§11 step 4).

**Review-fix cap reached** (§8).
- **Accept** → finish (§11, which sets the plan's `status:` to `done`); list the open findings verbatim in the report.
- **Direct** → one more fix round with the user's guidance (§8 step 3) and no further review; then finish (§11, which sets the plan's `status:` to `done`).
- **Abort** → leave the working state as it is and report (§11 step 4).

**Spec gap** (the planner returned `SPEC-GAP: …`; the spec is the user's, so the decision is too). Show the `SPEC-GAP` line verbatim and, at most, one line on what you checked.
- **Decide** → the user's answer, verbatim, goes with the finding to the analyst as a spec amendment (§9).
- **Abort** → end the run (§11 step 4).

**Task needs a human** (`human: true`). Show the task, the failure evidence file, and the attempts at each tier.
- **I fixed it** → run the task's Verify; on success mark it done and continue (commit per §7.3 step 7, with `task-done.mjs --no-outcome`); on failure stop again. This verify writes no **Outcome line**, even in a session that carries out a recorded `I fixed it` after a cut (§7.3: a human fix is not a developer attempt).
- **Retry at deep with guidance** → a new budget of N failures at `deep` (`marker.mjs set tasks.<key>.last_tier=deep tasks.<key>.failures_at_last_tier=0`), the user's guidance appended to the developer prompt; continue at §7.3 step 1, routing with `--retry <key> --record <key>`.
- **Skip** (FULL only; QUICK offers just the other three) → apply "Leftover edits" first; mark the task `[!] skipped` and every transitive dependent `[!] blocked`; stop the flow and offer an amendment (§9) or abort.
- **Abort** → apply "Leftover edits" first, then end the run (§11 step 4).

**Plan check failed** (§6 step 2 or 5: `plan.mjs check` still reports defects after one planner revision). Show the defect lines verbatim.
- **Direct** (the user gives guidance) → relay it with the defects to the planner (routed), then run the same check once more; continue the flow when it prints `ok`, otherwise stop again with these options.
- **Abort** → end the run (§11 step 4).

**Analyst questions unanswered** (blocking questions remain after `limits.questionRounds` rounds, or more questions than `limits.openQuestions`).
- **Answer now** → the analyst revises once more with the answers.
- **Proceed with assumptions** → the analyst marks each remaining question as an assumption under Open questions; continue to review.
- **Abort.**

**Verify set empty (QUICK) or a Manual task (FULL).** Neither answer writes an **Outcome line** (§7.3: a user's answer never produces one).
- **Confirm done** → treat it as a passed Verify (§7.3 step 7 Success) and continue.
- **Not done** → a failed attempt; the user's stated reason is written to the failure file (`.sdd/review/<slug>-<task>.fail.txt`) as the evidence (§7.3 step 8).

**Leftover edits** (an attempt's edits remain and no further attempt follows: design-gap `TASK-BLOCKED`, Skip, Abort, QUICK ladder exhausted, or an unlisted path found after a successful task). The **leftover set** = the files `git status --porcelain --untracked-files=all` shows modified, added or untracked, minus `dirty_at_start`, minus paths already in `kept`, minus run artifacts, minus the Files of tasks already marked `[x]` (after a successful task: only the paths outside its Files list). List it.
- **Keep** → leave them in place; flag them in the report; exclude them from later pre-flights; add them to the run paths (`marker.mjs push kept <paths>`) so the final review sees them.
- **Revert** → after the user confirms the exact list: restore modified files to `HEAD` (`git checkout HEAD -- <paths>`, for modified files only); unstage added files (`git rm --cached -- <paths>`) and then delete them; delete the untracked ones. This is the only time you restore or delete files.
In a non-git project the set cannot be computed: list only the developer's last report, and Revert is unavailable. Afterwards continue with the originating stop (Skip → amend or abort; Abort → end the run; design gap → amendment; QUICK exhaustion → report; successful task → run `task-done.mjs` again to commit it, then take the next task).

**Suite already failing** (§2 step 6: `verify.test` fails before any agent ran). Show the runner's failing lines.
- **I fixed it** → run the command again; on `pass` continue with §2 step 6 (read the lane's file), on `fail` show this stop again.
- **Abort.** (There is no "proceed anyway": every task's Verify would fail.)

**Dirty-files pre-flight** (a task's Files path has uncommitted changes).
- **Ready** → the user has committed or stashed them; re-check and continue (re-recording `dirty_at_start` only at the first entry to `executing`, §7.1).
- **Abort.** (There is no "proceed anyway".)

**Risk-floor refusal** (§2).
- **FULL** → proceed as FULL.
- **Rescope** → the user restates the request; re-triage.
- **Abort.**
