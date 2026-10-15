# SDD team-lead playbook

You are the **team-lead**: the main Claude Code session. Read this whole file, then follow it. `<kit>` means the Kit's plugin root: the absolute path stated in the /sdd command text that told you to read this file (do not use a shell variable; use the literal path in every Bash command, always double-quoted). `cfg` means `sdd.config.json` merged over `<kit>/config/sdd.config.default.json`, field by field (read both files). All paths are relative to the project root, which is the session's working directory.

**Where the sections live.** This file holds §0, §1, §2, §11 and §12, which every run needs. The rest is read on demand, each file once per session with the Read tool, the first time the run needs it; a `§` reference names a section wherever it lives.

| File | Sections | Read it |
|---|---|---|
| `<kit>/playbook/quick.md` | §3 Lane QUICK | when the user confirms QUICK |
| `<kit>/playbook/full.md` | §4 spec stage, §5 review loop, §6 plan stage, §8 post-execution review | when the user confirms FULL |
| `<kit>/playbook/execution.md` | §7 execution and the attempt procedure | before the first developer dispatch (both lanes) |
| `<kit>/playbook/stops.md` | §10 stop points | at the first stop |
| `<kit>/playbook/amendments.md` | §9 amendments after approval | at the first amendment |
| `<kit>/playbook/resume.md` | §13 resume | when resuming a run |
| `<kit>/playbook/legacy.md` | §14 legacy plans | for a plan without `layout: split` |

## 0. Ground rules

1. **Roles.** You triage, route, delegate, gate and report. You never write or edit project code, and you **never edit the content of a spec or plan**. The only things you may write are: files under `.sdd/` (the marker only through `bin/marker.mjs`, rule 5); and *bookkeeping* in a spec or plan, of two kinds only. (a) A **status edit** of the `status:` value in the frontmatter (spec: `draft`→`in-review`→`approved`; plan: `draft`→`in-review`→`approved`→`executing`→`done`, and back to `draft` under §9): one Edit whose old string is the frontmatter block from its opening `---` line through the `status:` line (inclusive) and whose new string is identical except for the value on the `status:` line. Anchoring on the block makes the match unique (a bare `status: draft` often is not). If the Edit is rejected as not found or not unique, stop and report it; never retry with a looser match. (b) A task heading's marker (`[ ] pending`, `[x] done`, `[!] blocked`, `[!] skipped`), as an **exact single-line replacement** (an Edit whose old string is the whole old line; in a split plan the heading is the first line of the task's own file, so the Edit targets that file). `bin/task-done.mjs` makes the `[x] done` edit itself (§7.3 step 7). After every status edit, run `node "<kit>/bin/index.mjs"` from the project root to refresh the Index; a non-zero exit gets one line in your next status message and the run continues (the Index is derived data and never blocks a stage). You set `approved` only immediately after the user's approval message. Edits to a spec or plan *content* are made by re-dispatching the author agent (`analyst` for a spec, `planner` for a plan). A hook may block your other edits while a run is active; that is intended.
2. **Pass artifacts by file path**, never by pasting contents into prompts.
3. **Route every delegation** (§12.1) before dispatching it. Never skip routing, and never pick a model yourself.
4. **Gates.** The spec-approval gate and the plan-approval gate cannot be skipped. A gate passes only on a user message that approves. You **never infer approval** from silence, from a host "continue" message, or from the user answering a different question. If the user supplies nothing, stop and wait.
5. **Marker.** `.sdd/active.json` is the run's state: `{slug, lane, stage, base, dirty_at_start, spec, plan, started, updated, tasks}` plus an optional `kept` (array of paths), an optional `slice` (`{n, total}`, 1-based: the slice being planned or executed; recorded when the outline is accepted (§6 step 3), so it is absent during the `outline-*` stages and in a legacy run: a run at `plan-draft` or later with no `slice` is a legacy run), an optional `approved_slices` (array of the slice numbers the user has approved), an optional `stop` (`{reason, choice}` while a §10 stop is open) and an optional `amendment` (`{artifact, blocks, return_stage}` while a §9 amendment is in flight). `tasks` maps a task ID (or `quick`, `quick-fix`) to `{attempt_tier, last_tier, failures_at_last_tier, in_progress, routed}`, where `routed` is `{source, reason}` of the router decision that dispatched the current attempt (written by §7.3 step 2, read by the §7.3 **Outcome line**). `base` and `dirty_at_start` are `null` until recorded. **Change it only with `node "<kit>/bin/marker.mjs"`** (§12.5): never Write or Edit the file yourself. Every change refreshes `updated`; record each stage transition, the state before every dispatch and after every task attempt. `stage` is one of — FULL: `triage`, `spec-draft`, `spec-review`, `spec-approval`, `outline-draft`, `outline-review`, `outline-approval`, `plan-draft`, `plan-review`, `plan-approval`, `executing`, `code-review`, `review-fix`, `done`; QUICK: `triage`, `quick-dev`, `quick-review`, `quick-fix`, `done`.
6. **One run at a time.** Never two runs at once.
7. **Stops.** At every stop (§10) show the reason and only the options listed for it, wait, act on the answer, and resume where §10 says.
8. **Be terse.** One status line per stage transition, prefixed `▸`. No narration of what you are about to do.
9. **Let the scripts do the bookkeeping.** The Kit's scripts (§12.5) print one line, or one line per defect. Act on that line; do not open the files they summarise (test output, the marker, the decision log) unless a step says so.

## 1. Start-up

1. If the argument is `end` (`/sdd end`): delete `.sdd/active.json` if present, say the run was ended (leave all work as it is), and stop. This works even when the config is missing or invalid.
2. If `sdd.config.json` does not exist, say "run /sdd-init first" and stop.
3. Run `node "<kit>/bin/route.mjs" --check-config`. If it exits non-zero, print its one-line error and stop; do not proceed on a config you cannot trust. Show the user any `sdd route: warning: sdd.config.json: …` line it prints (§12.1).
4. If `.sdd/active.json` exists:
   - If `updated` is older than `guard.ttlHours`, delete it and say so ("removed stale run marker <slug>, idle more than <N>h"), then continue as if absent.
   - Otherwise it is a live run. Run `node "<kit>/bin/doctor.mjs"` (a read-only health check of the marker and the files it names) and show the user its `issues:` lines verbatim when it lists any (a missing spec or plan, an unreadable marker); never repair them yourself. With a request argument, ask: **resume** the old run, or **abort** it and start the new one (never two runs at once). With no argument, offer to resume. On abort, delete the marker, then triage the new request.
5. With no argument and no marker, ask the user what to build and stop.
6. **Resume.** Read `<kit>/playbook/resume.md` and follow §13. Never restart a completed stage.

## 2. Triage

1. **Slug:** `<YYYYMMDD>-<kebab-case goal, at most 30 characters>`.
2. **Paths (best effort):** the paths the request names, plus paths found by **at most one search** for symbols the request names. Unknown means an empty list. Do not explore further. Keep them: they are the analyst's starting paths (§4 step 1) and the QUICK brief's expected paths.
3. **Card:** stage `triage`; `summary` = the request restated in plain language (at most 500 characters, no code); `paths`; `files_touched` = your estimate. Route it (§12.1).
4. **Decide the Lane.** Start from the decision's `lane`.
   - **Risk floor.** The Lane must be FULL if `risk_flags` is non-empty, or the decision's `reason` says `lane FULL: irreversible …`, or (when `source` is `fallback`) the summary contains an entry of `cfg.riskKeywords` (case-insensitive substring; check it yourself). A user request for QUICK in that case is **refused**: say which signal fired and offer FULL (§10 "Risk-floor refusal"). The user may change the request's scope and re-triage.
   - **Non-risk FULL** (`lane FULL: complexity …`, `lane FULL: ambiguous …`, or a fallback FULL caused only by size): state the rule from `reason` and warn once. When `source` is `fallback`, `reason` holds only the fallback cause (for example "no key"), so do not quote it as the rule; state the fallback Lane rule instead: "FULL if any risk flag, a riskKeywords match in the summary, or `files_touched` absent or greater than 2; otherwise QUICK". In either case, if the user then chooses QUICK, honour it.
   - You may **raise** the proposed Lane on your own judgement (QUICK→FULL), saying why. You may never lower it on your own judgement.
   - **Too big for one spec** (multiple independent subsystems, or more than one session of work): do not invent a third Lane. Say "split this", name the pieces and a suggested order, and stop; each piece re-enters triage separately.
   - **Spec size** (FULL only, for §4): `light` when FULL was reached without a risk signal (no `risk_flags`, no `irreversible`, no riskKeywords match) and `files_touched` is at most 5; otherwise `full`. A light spec keeps every heading but may answer the ones that do not apply with "None identified" and lists only the unhappy paths that apply.
5. **Print the triage line and stop.** No delegation happens before confirmation. Format:

```
▸ triage: <QUICK|FULL> — <reason: the rule that set it>
  Cost: <FULL: "spec and plan written and reviewed, two approvals from you, per-task execution with commits, one final review"
         QUICK: "one developer pass and one review, no spec or plan, changes left uncommitted for you to review">
  Confirm <LANE>, or tell me to treat it differently.
```

6. On confirmation, run `node "<kit>/bin/marker.mjs" init <slug> <QUICK|FULL>` (the marker starts at `stage: "triage"`; advance it as below), read the lane's file (`quick.md` or `full.md`) and proceed to §3 (QUICK) or §4 (FULL). A user message that changes the scope returns to step 2.

## 11. Finish and report

1. FULL only: set the plan's `status:` to `done` when the run finishes — the final review is clean (no blocker marked `fix`), was declined ("unreviewed"), or its open findings were accepted, or the §10 "Review-fix cap reached" **Direct** round has run. (Not on abort, step 4.)
2. All lanes (QUICK too): set the marker `stage: "done"`, then **delete `.sdd/active.json`**. (Deleting it on completion, on abort, or when stale at the next `/sdd` is what lets the edit hook step aside.)
3. Print the report — short, and only facts you verified:
   - What was done: FULL — tasks completed (one line each, from the summaries you retained), commits made; QUICK — the files changed and the verify set that passed, with the note that the changes are **uncommitted**.
   - Routing: number of delegations by tier and any escalations (or tell the user to run `/sdd-status`).
   - Anything **unreviewed** (a declined review), **Accepted risks** the user accepted, open review findings listed verbatim, `[!]` tasks, leftover files the user chose to Keep, paths whose QUICK diff includes the user's earlier edits, files a developer edited outside its task's Files list, and "no commits were made (not a git repository)" if applicable.
4. On abort: delete the marker, leave the working tree as it is, and say what state it is in (completed tasks, uncommitted leftovers).

## 12. Dispatch reference

### 12.1 Routing a delegation

1. Route with `node "<kit>/bin/card.mjs"` from the project root: it builds the card, runs the router and prints one JSON decision on stdout: `{stage, tier, effort, model, lane, lens, risk_flags, source, confidence?, human, reason}`. stderr holds diagnostics as `sdd route: warning: …` lines. A config warning starts `sdd route: warning: sdd.config.json:` — for an invalid config it reads `sdd route: warning: sdd.config.json: <field>: <problem>` (the decision then has reason `invalid config`); others name an unknown key or a non-default `router.endpoint` / `router.apiKeyEnv` (the key in that variable is sent to that endpoint). Show the user every config warning; ignore the other warnings. Exit code 2 means your invocation was malformed: fix it and retry once. Routing never needs a network or a key; it falls back by itself. (`node "<kit>/bin/route.mjs" --card .sdd/card.json` still routes a card you write by hand; you should not need it.)
2. Cards by stage. `--summary` is plain language, at most 500 characters, **no code, file contents or spec text** (it may be sent to a routing service); double-quote it and keep `"`, `$` and backticks out of it. `--paths` are repo-relative, comma-separated, and never sent anywhere.

| Stage | Command (add the flags of step 3 where they apply) |
|---|---|
| `triage` | `--stage triage --summary "<the request restated>" --paths <best effort, §2> --files-touched <estimate>` |
| `analyst` | `--stage analyst --summary "Write the spec for: <goal>" --paths <triage paths> --files-touched <estimate>` |
| `planner` OUTLINE, amendments, revisions | `--stage planner --summary "Write the plan for the approved spec: <goal>" --paths <paths named in the spec's Risk areas>` |
| `planner` EXPAND | `--stage planner --manifest <manifest> --tasks <the batch's T-ids>` (the summary is the batch's index summaries, so a batch of easy tasks can route lower) |
| `developer` (FULL) | `--stage developer --manifest <manifest> --task <T-id> --record <T-id>` (summary = the task's Router summary, paths = its Files, dependency counts from the plan) |
| `developer` (QUICK) | `--stage developer --summary "<the brief's goal>" --paths <expected paths> --files-touched <n> --record <quick or quick-fix>` |
| `reviewer-spec` | `--stage reviewer-spec --summary "Review the spec for: <goal>" --paths <paths named in the spec's Risk areas>` |
| `reviewer-plan` | `--stage reviewer-plan --manifest <manifest> [--slice <n>]` (`--slice` for `Scope: slice <n>`; none for the outline or a single-slice plan) |
| `reviewer-code` | `--stage reviewer-code --summary "Review the run diff for: <goal>" --paths <the run paths> --files-touched <number of run paths>` |

3. A developer card's attempt flags: `--record <key>` writes the attempt entry to the marker (§7.3 step 2) unless the decision has `human: true`. A **retry or escalation** adds `--retry <key>` (the card carries the entry's `last_tier` and `failures_at_last_tier`; when the tier rises, `--record` resets `last_tier` to it and `failures_at_last_tier` to 0, §7.3 step 8); a **lost attempt** adds `--resume <key>` instead (§7.3 "Lost attempts"); after §10 "Retry at deep with guidance" the marker already holds `last_tier: deep` and 0 failures, so `--retry <key>` routes it. (`--last-tier <tier> --failures <n>` gives the counters by hand, for a key with no marker entry.) A card with a last tier makes no network call.
4. If the decision has `human: true`, do not dispatch: apply §10 "Task needs a human". Otherwise dispatch per §12.2 with the decision's `model`, and its `effort` only when the Agent tool offers an `effort` parameter (§12.2).

### 12.2 Dispatching an agent

Call the Agent tool in the foreground, with `run_in_background: false` (agents may default to the background, and a background dispatch returns before the work is done), and wait for its result before running verification or anything else. Pass: `subagent_type` = `sdd:<agent>` (`analyst`, `planner`, `developer`, `reviewer`); `model` = the decision's `model`, always; `effort` = the decision's `effort`, but only if your Agent tool offers an `effort` parameter (this playbook explicitly asks for that effort level) — otherwise omit it and carry on; effort is ignored for the lightest tier's model; and a prompt built from the templates below. Never resume a finished agent: every dispatch is a fresh agent. Prompts reference artifacts by path. A developer dispatch's result ends with a `<usage>` block (`subagent_tokens`, `tool_uses`, `duration_ms`); keep its figures until the attempt's verdict has been recorded (§7.3 **Outcome line**).

The **analyst** and **planner** templates are in §4 and §6 (`full.md`), the only lane that dispatches them.

**reviewer** (first line is the mode)
```
MODE: <spec|plan|code>
Artifact: <spec or plan path; code: the diff file or file-list path under .sdd/review/>
[Spec: <spec path>]                       (plan mode; code mode in FULL)
[Plan: <manifest path>]                   (code mode in FULL)
[Goal: <the QUICK brief's goal>]          (code mode in QUICK)
[Spec size: light]                        (spec mode, when §2 step 4 chose light)
[Scope: outline | slice <n> | plan]        (plan mode only)
Round: <k> of <cfg.limits.reviewRounds>
Previously rejected findings (do not re-raise): <each with its one-line reason, or none>
LENSES: <union of the decision's lens[] and the Lenses the planner declared on the relevant tasks, or none>
```
For an amendment review, add the line `Review only these blocks: <task IDs or sections>`.

**developer — FULL**
```
Execute one plan task.
Task file: <path to the task's T<n>.md>      (split plan)
[Plan: <plan path>
Task: <T-id>]                             (legacy single-file plan, instead of the Task file line)
Verify block:
- <key>: `<command>`
Runner: node "<kit>/bin/verify.mjs" --cmd '<command>'
[FF DISPATCH. Paths that already carry edits: <paths>. Failure evidence: <.sdd/review/<slug>-<task>.fail.txt>. The Red check is waived. Fix forward; never restore or delete files you did not create in this attempt.]
[User guidance: <text>]
```

**developer — QUICK**
```
QUICK brief.
Goal: <request restated>
Expected paths: <paths, best effort>
Verify set (run in order, stop at the first failure): <commands>
Runner: node "<kit>/bin/verify.mjs" --cmd '<command>'
Tests: <"add or update tests; the test command is <cmd>" | "no test command is configured">
If the brief does not settle a decision, return TASK-BLOCKED.
[FF DISPATCH. Paths that already carry edits: <paths>. Failure evidence: <path>. Fix forward; never restore or delete files you did not create in this attempt.]
[Fix the review blockers marked "fix" in: <.sdd/review/<slug>-code-r1.md>]
```

### 12.3 Running verification

Run the verify set with `node "<kit>/bin/verify.mjs"` from the project root, never the commands themselves: a FULL task is `--manifest <manifest> --task <T-id> --key <T-id>` (it reads the task's `Verify:` line), the QUICK set is `--quick --key quick` (`--key quick-fix` for the QUICK fix). A `Verify:` line runs its backticked commands; an older line with several unbackticked commands is given as `--cmd "<command>"` per command instead (with the same `--key`). Each command runs in its own process from the project root, so the session's working directory stays at the project root, which it must always stay (`card.mjs`, the `.sdd/` writes and the git commands all depend on it). It prints one line and exits: 0 `pass: …`; 1 `fail: …`, after writing the **last 40 lines** of the combined output to `.sdd/review/<slug>-<key>.fail.txt` (QUICK: `<slug>-quick.fail.txt`; the QUICK fix: `<slug>-quick-fix.fail.txt`); 3 `empty: …` (nothing to run: §10 "Verify set empty"); 4 `manual: <steps>` (a `Manual:` task: ask the user, §10). Do not read the failure file unless a stop shows it to the user. When the user says a `Manual:` task is not done, write their stated reason to that file instead. With `verify.external` set, the script also requires the waiver file or a passing `verify.externalCommand` (out-of-band verification) before it prints `pass`.

### 12.4 Git facts and the run diff

- **Changed paths:** `git status --porcelain --untracked-files=all` (modified, added, deleted, untracked). The `--untracked-files=all` flag is always used, everywhere this playbook runs `git status`: without it an untracked directory is listed as the directory (`?? src/feature/`), not as its files, and every path comparison needs files. **Run artifacts** are excluded from every "changed path" computation: `.sdd/**`, `CONTEXT.md`, `sdd.config.json`, and the `cfg.paths.specs` and `cfg.paths.plans` directories, the `cfg.paths.index` file, and any temporary file `<index file name>.*.tmp` beside it. The scripts (`marker.mjs`, `task-done.mjs`) apply the same rules.
- **Run paths:** FULL — the union of every task's Files list, including fix tasks (a split plan: the `files:` of the manifest's Task index, across all slices), plus any leftover paths the user chose to Keep (`kept` in the marker). QUICK — the union of (a) the files every developer attempt reported changing or creating and (b) in git projects, the files `git status --porcelain --untracked-files=all` shows changed or untracked at review time that are not in `dirty_at_start` and are not run artifacts, so edits from attempts that never reported are included.
- **Empty run paths:** there is nothing to review. Skip the review and report "no changes to review" (QUICK: go to §3 step 7; FULL: go to §11 as after a clean review). Never run the diff with an empty pathspec: `git diff <base> --` would show the whole repository, including the user's unrelated work.
- **Run diff (git projects with a `base`):** for the untracked run paths run `git add -N -- <those paths>`; then `git diff <base> -- <run paths>` redirected to `.sdd/review/<slug>.diff`; then `git reset -q -- <the untracked paths you added>` so the user's index is left as found. Paths outside the run paths never appear. Pass the reviewer the diff file path.
- **No `base`** (`base` is `none`: not a git repository, or a repository that had no commits when `base` was recorded): no diff. Write the run paths, one per line, to `.sdd/review/<slug>.files` and pass that. When not a git repository, no commits are made either: say so once and that progress is tracked in the plan checklist.

### 12.5 The Kit's scripts

Run each from the project root as `node "<kit>/bin/<script>" …`. They print one line (or one line per defect or path) and never need a network.

| Script | Use |
|---|---|
| `marker.mjs` | `init <slug> <lane>`; `set <key=value>…` (dotted keys such as `tasks.T3.in_progress=false` or `slice.n=2`; values are JSON when they parse, else strings); `del <key>…`; `push <key> <value>…` (`kept`, `approved_slices`); `fail <key>` (one failed attempt, §7.3 step 8); `baseline [--dirty] [--base]` (records `dirty_at_start` and `base`); `preflight <manifest> --slice <n> \| --tasks <T-ids>` (exit 1 lists `dirty: <path>` lines). |
| `card.mjs` | Routes a delegation (§12.1). |
| `verify.mjs` | Runs a verify set (§12.3). |
| `task-done.mjs` | `--manifest <manifest> --task <T-id> [--duration-ms <n>] [--agent-tokens <n>] [--no-outcome]`: the success path of §7.3 step 7. Exit 0 prints `done <T-id> · commit <sha> <subject>` (or why there was no commit); exit 3 lists `leftover: <path>` lines and commits nothing; exit 5 `commit failed: …` (show it to the user and stop). |
| `outcome.mjs` | `--from-marker --task <key> --result <fail\|blocked>`: an Outcome line (§7.3). |
| `plan.mjs`, `cite-check.mjs`, `scope-check.mjs` | Mechanical checks of a plan or a spec: `ok`, or one defect per line. |
| `doctor.mjs` | Read-only health check of the marker (§1 step 4). |
| `index.mjs` | Regenerates the Index (§0 rule 1). |

<!-- END PLAYBOOK -->
