---
description: Show the active SDD run and a summary of routing decisions (tiers, sources, escalations, TypeSafe tokens)
argument-hint: (no arguments)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/status.mjs"` from the project root and show its output to the user verbatim. If it exits non-zero, show its stderr line (an invalid `sdd.config.json`) and stop. Do not read or modify any other file.
