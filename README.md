# Claude Code SDD Plugin

SDD stands for spec-driven development. This is a plugin for [Claude Code](https://claude.com/claude-code) that makes Claude work in a fixed order on any non-trivial change:

1. Write a spec that says what to build and why.
2. Turn the spec into a plan of small tasks.
3. Run the tasks one at a time, checking each one.
4. Review the result.

You approve the spec and the plan before any code is written. Claude does not move on until you say so.

The plugin is language-agnostic. It does not care if your project is JavaScript, Python, C# or something else. You tell it your build and test commands once, and it uses those.

Current version: **0.5.3** (see [CHANGELOG.md](CHANGELOG.md)).

## Why use it

Left alone, a coding agent often starts typing before it has understood the request. That works for small edits and goes badly for bigger ones. SDD adds the steps a careful developer would take:

- The request is written down as a spec with numbered acceptance criteria, so "done" means something.
- A second agent that did not write the spec reads it cold and looks for gaps.
- The plan is split into tasks small enough that an agent can do one without making design decisions.
- Each task is verified with your real build and test commands, not with the agent's say-so.
- Cheap models do easy work and stronger models do hard work, so you don't pay top price for everything.

## How a run works

You start with `/sdd:sdd <what you want built>`. The first thing you see is a triage line. It proposes a **lane** and tells you what that lane costs. Nothing happens until you confirm.

### Two lanes

**QUICK** is for small, low-risk changes.
- No spec, no plan.
- One developer pass, then one review.
- Changes are left uncommitted so you can look at them first.

**FULL** is for anything bigger or riskier.
1. The analyst writes a spec. Open questions come back to you, each with a recommended answer.
2. Two mechanical checks run on the spec: every `path:line` it cites must exist, and it must not be too large (default cap: 20 acceptance criteria). If it is too big, the plugin tells you to split the work.
3. A reviewer reads the spec. Up to three rounds of fixes.
4. **You approve the spec.**
5. The planner writes an outline, then one file per task. Long plans are cut into slices (default: more than 12 tasks).
6. A reviewer reads the plan.
7. **You approve the plan.**
8. A developer agent does each task, test-first. The plugin runs the task's verify command itself, then commits. One commit per task.
9. A final reviewer reads the whole diff. Blocking findings get fix tasks.
10. You get a report.

### Risk floor

Some work can never go through QUICK, however small. If the request touches auth, money, database schema or migrations, public API contracts, personal data, or deleting things, it goes to FULL. The plugin detects this from file paths, from the router's "irreversible" flag, and from keywords like `delete`, `password` or `refund`. If you ask for QUICK on that kind of change, it says no and explains which signal fired.

## The four agents

| Agent | What it does | What it can touch |
|---|---|---|
| **analyst** | Writes the spec. Asks open questions. | Reads the repo. Writes only the spec file (and new terms in `CONTEXT.md`). |
| **planner** | Turns an approved spec into a manifest plus one file per task. Also writes fix tasks. | Writes only plan files. |
| **developer** | Does exactly one task. Writes the failing test first, then the code. | Edits only the files listed in its task. |
| **reviewer** | Reads a spec, a plan or a code diff with no prior context. | Read-only. |

The main Claude session acts as the **team-lead**. It triages, picks models, dispatches the agents above, runs the gates, and talks to you. It does not edit your code. The reason it is the main session and not a subagent is that subagents cannot start other subagents.

Each developer only sees its own task file. It never sees the spec or the other tasks. This keeps the task self-contained and keeps token use down.

### Rules the agents follow

- Reuse what already exists (a helper in your code, the standard library, an installed dependency) before writing something new. Every plan task has a `Reuse:` line that says what was searched.
- Keep the change as small as it can be. No extra abstractions or options nobody asked for.
- A task touches at most 5 files and changes one behaviour.
- A reviewer reports only real blockers. Zero blockers is a normal result. Findings that were already rejected are not raised again.

## Commands

Plugin commands are namespaced, so type the full name. A bare `/sdd` will not resolve.

| Command | What it does |
|---|---|
| `/sdd:sdd-init` | One-time setup for a project. Run this first. |
| `/sdd:sdd <request>` | Start a run. |
| `/sdd:sdd` | With no argument, resume the active run. |
| `/sdd:sdd end` | Abort the active run. Your work is left as it is. |
| `/sdd:sdd-status` | Show the active run and a summary of routing decisions. |

## Install

You need:

- Node.js 18 or later. The plugin's scripts use only Node built-ins, so there is no `npm install`.
- Claude Code. Version 2.1.292 or later is recommended. Older versions work, but per-task effort is not applied because their Agent tool has no `effort` parameter.
- Git is recommended. Without it the plugin makes no commits and reviews a list of files instead of a diff.
- Optional: a [TypeSafe](https://typesafe.ai) API key for smarter model routing (see below).

Clone the repo:

```bash
git clone https://github.com/ljournllagas/claude-code-sdd-plugin.git
```

Then start Claude Code in the project you want to work on and point it at the clone:

```bash
claude --plugin-dir "/path/to/claude-code-sdd-plugin"
```

This loads the plugin for that session only. Add the flag every time you start Claude Code. Quote the path if it contains spaces.

To check the plugin manifest:

```bash
claude plugin validate "/path/to/claude-code-sdd-plugin"
```

### Persistent install

This repo does not ship a marketplace file yet, so there is no one-line install from GitHub. If you want the plugin in every session without the flag, create a local marketplace folder that has a `.claude-plugin/marketplace.json` pointing at a copy of this plugin, then use `claude plugin marketplace add` and `claude plugin install`. I have validated that approach on a local folder but have not tested it against this GitHub repo.

## First run in a project

1. Start Claude Code in your project with the plugin loaded.
2. Run `/sdd:sdd-init`. It looks for your build, test, lint, typecheck and format commands, then asks you to confirm each one. Anything you don't confirm is set to `null`. It then creates:
   - `sdd.config.json` with your confirmed commands
   - `docs/sdd/specs/` and `docs/sdd/plans/`
   - `CONTEXT.md`, a glossary where terms get defined once
   - a `.sdd/` line in `.gitignore`, because the decision log holds task summaries and should not be committed

   It never overwrites an existing config or `CONTEXT.md`.
3. Run `/sdd:sdd <what you want built>`.

If you leave `test` as `null`, the planner writes build/typecheck/lint checks or manual steps instead of automated tests. It tells you so.

Detection knows about common toolchains. All of that knowledge lives in [config/detectors.json](config/detectors.json), so adding a language means editing one JSON file.

## Model routing and cost

The plugin routes every delegation to one of three tiers:

| Tier | Default model | Default effort |
|---|---|---|
| light | haiku | low |
| standard | sonnet | medium |
| deep | opus | high |

The mapping is in the config and you can change it.

Two ways the tier is chosen:

- **With a TypeSafe key.** The router sends a short task summary (500 characters at most), counts and risk flags to TypeSafe. It gets back a kind of work, a complexity score and flags for ambiguous, irreversible and cross-file. It never sends file contents, diffs, spec or plan text, or file paths.
- **Without a key.** It uses a built-in table that maps each stage to a tier. This is the `fallback` source.

If the router can't be reached for any reason, it falls back to the table. A failure there never stops a run.

To turn on TypeSafe routing, set `TYPESAFE_API_KEY` in your environment before starting Claude Code.

PowerShell, this session only:
```powershell
$env:TYPESAFE_API_KEY = "<your key>"
```

Bash:
```bash
export TYPESAFE_API_KEY="<your key>"
```

Never commit the key. The router endpoint must be `https` (plain `http` is allowed only for localhost). The plugin warns on stderr if `router.endpoint` or `router.apiKeyEnv` is changed from the default, because the variable's value is sent as the bearer token.

### Escalation

If a task fails verification twice at one tier (the default), the next attempt moves up a tier. If it fails twice at `deep`, the task goes to you. Low router confidence also bumps the tier up one step before the first attempt.

### Looking at the numbers

`/sdd:sdd-status` shows the active run, decisions by tier and source (`typesafe` or `fallback`), escalations, and outcomes. Every router decision and every developer result is appended to `.sdd/decisions.jsonl`. It stays on your machine.

## The edit guard

While a run is active, a hook blocks the main session from editing project files. The developer subagents do the editing. The team-lead can only touch run files such as `.sdd/` and the status line and task markers in specs and plans.

The marker file is `.sdd/active.json`. It expires after 12 hours. If a run is abandoned and the block is in your way, run `/sdd:sdd end` or wait for it to expire.

The hook fails open. If its input or your config is unreadable, it lets the edit through instead of locking you out.

## Configuration

`sdd.config.json` in your project is merged over [config/sdd.config.default.json](config/sdd.config.default.json), field by field. `/sdd:sdd-init` writes only the `verify` block. Everything else you add yourself. The file is validated on load against [config/sdd.config.schema.json](config/sdd.config.schema.json).

| Setting | What it controls |
|---|---|
| `models`, `efforts` | Which model and effort each tier maps to. |
| `router` | TypeSafe on/off, endpoint, key variable, timeout, confidence thresholds. |
| `stageFloors`, `fallbackTiers` | The lowest tier each stage may use, and the tier used when the router is down. |
| `riskPaths`, `riskKeywords` | What counts as risky work, which forces FULL. |
| `verify` | Your build, test, lint, typecheck, format and single-test commands. Also out-of-band verification (see below). |
| `paths` | Where specs, plans, the log, the run marker and the index live. |
| `limits` | Review rounds, failures per tier, open questions, slice size, acceptance-criteria cap, task file length. |
| `guard.ttlHours` | How long a run marker stays live. |

### Verification that happens outside Claude

If your tests can't run in the session (a separate CI, a device lab), set `verify.external` to `true`. A run then needs either a recorded waiver file or a passing `verify.externalCommand` before a verify step counts as satisfied.

## What gets written into your project

```
sdd.config.json          your confirmed commands and overrides
CONTEXT.md               project glossary
docs/sdd/specs/          one spec per FULL run
docs/sdd/plans/          one manifest per run, plus <slug>/T1.md, T2.md ...
docs/sdd/index.md        generated catalogue of specs and plans (do not edit)
.sdd/                    run state, review records, decision log (git-ignored)
```

Specs and plans start with a small frontmatter block (`type`, `title`, `description`, `status`, `timestamp`). The `status` field is how the plugin tracks progress. A spec goes `draft`, `in-review`, `approved`. A plan goes `draft`, `in-review`, `approved`, `executing`, `done`.

## Resuming after a cut-off

Runs are built to survive a closed terminal or a lost session. State lives in files: the run marker, the status in each spec and plan, the task checklist and the review records. Run `/sdd:sdd` with no argument and it picks up at the recorded stage.

Plans are written in pieces for the same reason. A cut-off during planning costs at most one task file, and finished task files are never rewritten.

An attempt that was lost mid-task is retried at the same tier and does not count as a failure.

## Helper scripts

These are in [bin/](bin/) and need only Node. The team-lead calls them, but you can run them yourself.

| Script | What it does |
|---|---|
| `route.mjs` | The router. Takes a task card, prints a tier decision. `--check-config` validates your config. |
| `detect.mjs` | Proposes verify commands from the manifests in your repo. |
| `index.mjs` | Rebuilds `docs/sdd/index.md` from artifact frontmatter. |
| `plan.mjs` | Lists a plan's tasks and checks a plan mechanically (`tasks`, `check`). |
| `cite-check.mjs` | Checks every `path:line` citation in a spec. |
| `scope-check.mjs` | Rejects specs with too many acceptance criteria. |
| `outcome.mjs` | Appends one developer-attempt result to the decision log. |
| `status.mjs` | Prints the run summary used by `/sdd:sdd-status`. |
| `doctor.mjs` | Read-only health check of a run marker and the files it points to. |
| `verify-waiver.mjs` | The out-of-band verification gate. |

## Repo layout

```
.claude-plugin/plugin.json   plugin manifest
agents/                      analyst, planner, developer, reviewer prompts
commands/                    /sdd, /sdd-init, /sdd-status
playbook/team-lead.md        the full procedure the main session follows
hooks/                       the edit guard
bin/                         helper scripts
config/                      defaults, schema, toolchain detectors
templates/                   spec, plan, task and task-card templates
test/                        tests and fixtures
```

## Tests

```bash
node --test "test/*.test.mjs"
```

At the time of writing: 273 tests, 272 pass, 1 is skipped on Windows. No install step is needed.

## Known limits

- The helper scripts, the guard and the router are covered by automated tests. The team-lead playbook is written instructions for Claude, so it can't be unit-tested. It has not been walked end to end on a real session. There are twelve scenarios in [test/fixtures/dry-run-scenarios.md](test/fixtures/dry-run-scenarios.md) to try.
- Some messages from the plugin say `/sdd` and `/sdd-init` without the namespace. Read them as `/sdd:sdd` and `/sdd:sdd-init`.
- Specs and plans from version 0.1.0 need a frontmatter block added by hand. Until then they show up as "Unindexed". Plans from 0.2.0 keep working without changes.
- There is no license file in this repo yet.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
