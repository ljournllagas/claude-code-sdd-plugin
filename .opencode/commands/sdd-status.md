---
description: Show the active SDD run and a summary of routing decisions (tiers, sources, escalations, TypeSafe tokens)
---

Run `node "<kit>/bin/status.mjs"` from the project root and show its output to the user verbatim. `<kit>` is the directory that contains `.opencode/` (the SDD kit checkout root — use the literal absolute path, double-quoted). If it exits non-zero, show its stderr line (an invalid `sdd.config.json`) and stop. Do not read or modify any other file.
