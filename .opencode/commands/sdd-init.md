---
description: Set up SDD in this project — detect build/test commands, confirm them with you, and create the config, folders and glossary
---

Initialise spec-driven development in the current project. Do these steps in order; the plugin root `<kit>` is the directory that contains `.opencode/` (the SDD kit checkout root). Use the literal absolute path, double-quoted, in every shell command.

1. **Existing config.** If `sdd.config.json` exists, run `node "<kit>/bin/route.mjs" --check-config`. If it fails, print its one-line error and stop. If it is valid, remember it: you will **never overwrite** it (step 5).
2. **Detect.** Run `node "<kit>/bin/detect.mjs"` from the project root. It prints `{"candidates":[{"source","dir","verify":{build,test,lint,typecheck,format,testOne}}]}`. Missing keys are `null`.
3. **Confirm with the user, per key.** For each of `build`, `test`, `lint`, `typecheck`, `format`, `testOne`:
   - One candidate: show its command for the key and ask the user to accept it, edit it, or set it to `null`.
   - Several candidates: show all of them side by side (source, directory, command) and ask which one to use for each key, or a command of their own, or `null`.
   - No candidates: ask for each key; the user may leave it `null`.
   Each command is one string run from the project root (a command for a subdirectory already starts with `cd <dir> &&`). `testOne` is a template with a `{target}` placeholder. **Anything the user does not explicitly confirm is `null`.** Never invent a command.
4. **Create folders.** `docs/sdd/specs/` and `docs/sdd/plans/`.
5. **Write `sdd.config.json`.** If none exists, write `{"version": 1, "verify": {<the six confirmed values>}}` — nothing else; every other setting comes from the Kit defaults. If one already exists, **never overwrite** it: show the user a diff between it and the `verify` values just confirmed, and change it only if they say so.
6. **Glossary.** If `CONTEXT.md` does not exist, create it from `<kit>/templates/starter-context.md`. Never overwrite an existing `CONTEXT.md`.
7. **Ignore run state.** If the project is a git repository (`git rev-parse --is-inside-work-tree` succeeds) and `.gitignore` has no line `.sdd/`, `.sdd` or `/.sdd/`, append `.sdd/` on its own line (create the file if needed; if the file does not end with a newline, add one first so `.sdd/` is not joined to the last line). The decision log contains task summaries, so it must not be committed.
8. **Final check.** Run `node "<kit>/bin/route.mjs" --check-config`; it must print `ok`. Then run `node "<kit>/bin/index.mjs"` once from the project root to create the Index of specs and plans (a non-zero exit is reported, not fatal). Report what was created, and which of `test`/`build` are `null` (with `test` null the planner will use Check:/Manual: steps instead of automated tests; say so).
9. Tell the user the router is optional: with no key in the environment variable named by `router.apiKeyEnv` (default `TYPESAFE_API_KEY`) the Kit uses its built-in tier table; set the key to enable TypeSafe-backed routing.
