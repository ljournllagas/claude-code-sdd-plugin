---
type: plan
title: Add shout function
description: Adds an exported shout(name) to greet.js that returns greet(name) upper-cased, with unit tests in greet.test.js.
status: executing
timestamp: 2026-10-15
layout: split
---

# Add shout function — Plan

**Spec:** docs/sdd/specs/demo-shout.md
**Task count:** 1

## Verify block

- test: `npm test`
- testOne: `npm test -- {target}`

## Accepted risks

None

## Coverage matrix

| AC | Tasks |
|---|---|
| AC-1 | T1 |
| AC-2 | T1 |
| AC-3 | T1 |
| AC-4 | T1 |
| AC-5 | T1 |
| AC-6 | T1 |

## Slices

- Slice 1 — shout export with tests

## Task index

- T1 — Export shout from the greet module · slice 1 · ACs: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6 · deps: none · files: `greet.js`, `greet.test.js`
  summary: Add an exported function named shout to the existing greet module. It calls greet with the same name and returns the result upper-cased; greet itself stays unchanged. Add unit tests to the existing greet test file.
