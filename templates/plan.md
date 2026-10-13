---
type: plan
title: <Feature name>
description: <One sentence: what this plan builds>
status: draft
timestamp: <YYYY-MM-DD>
layout: split
---

# <Feature name> — Plan

**Spec:** <path to the approved spec>
**Task count:** <n>

<!-- This file is the manifest of a split plan. It holds no task bodies and no task markers: each task lives in its own file `<plans dir>/<slug>/T<n>.md` (template: templates/task.md), written later in batches. Write the outline first: slices, the coverage matrix and one index entry per task. -->

## Verify block

<!-- Copy the non-null commands from sdd.config.json `verify`, one per line, exactly:
- build: `<command>`
- test: `<command>`
Every Red/Green/Verify command in a task must appear verbatim here (or be the task's own targeted test command built from the `testOne` template). -->

## Accepted risks

None

## Coverage matrix

<!-- Every spec AC appears exactly once on the left, mapped to the tasks that satisfy it.
| AC | Tasks |
|---|---|
| AC-1 | T1 |
| AC-2 | T1, T2 | -->

## Slices

<!-- One line per slice, numbered from 1 without gaps. A slice holds at most the slice cap of tasks (limits.sliceMaxTasks); a plan at or under the cap has exactly one slice. Each slice depends only on itself and earlier slices.
- Slice 1 — <title> -->

## Task index

<!-- One entry per task, in execution order (dependencies first), exactly in this form. Fields are separated by " · "; write `deps: none` when there are none; files are repo-relative paths in backticks; the summary is the task's Router summary (at most 500 characters, plain language, no code).
- T1 — <title> · slice 1 · ACs: AC-1, AC-2 · deps: none · files: `path/one`, `path/two`
  summary: <Router summary> -->
