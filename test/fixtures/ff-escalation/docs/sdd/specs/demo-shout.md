---
type: spec
title: Add shout function
description: Decides that greet.js exports a shout(name) function returning the greet(name) greeting converted to upper case.
status: approved
timestamp: 2026-10-15
---

# Add shout function — Spec

## Goal

Callers of the greeting module get a `shout(name)` function that returns the same greeting as `greet(name)`, but in upper case. Deriving it from `greet` keeps the two greetings consistent if the greeting wording ever changes.

## Background

- `greet.js:1` exports a single function `greet(name)`; `greet.js:2` returns the template string `Hello, ${name}`. No `shout` function exists today.
- `greet.test.js:1` uses the built-in `node:test` runner and `greet.test.js:2` uses `node:assert/strict`; `greet.test.js:6` asserts `greet('Ada')` equals `'Hello, Ada'`.
- `package.json:1` declares the package as an ES module (`"type": "module"`) and runs tests with `node --test`.
- `greet` does no input validation: any value is interpolated into the string (`greet.js:2`).
- The Index `docs/sdd/index.md` lists no earlier specs or plans, so nothing overlaps.

## Glossary terms

None identified (`CONTEXT.md` holds only the template placeholder entry; "greeting" is used in its plain meaning: the string returned by `greet(name)`).

## Requirements

### Acceptance criteria

- **AC-1** Given the module `greet.js`, when it is imported, then it exports a function named `shout` alongside the existing `greet`.
- **AC-2** Given the name `'Ada'`, when `shout('Ada')` is called, then it returns `'HELLO, ADA'`.
- **AC-3** For any string `name`, `shout(name)` returns exactly `greet(name)` converted to upper case.
- **AC-4** Given the empty string, when `shout('')` is called, then it returns `'HELLO, '`.
- **AC-5** Given a name already in upper case or containing non-letters (for example `'R2-D2'`), when `shout` is called, then the non-letter characters are unchanged and the result is `'HELLO, R2-D2'`.
- **AC-6** After the change, `greet('Ada')` still returns `'Hello, Ada'` (existing behaviour unchanged).

### Unhappy paths

- **Empty:** `shout('')` returns `'HELLO, '`, mirroring `greet('')` — AC-4.
- **Partial / mixed input (already upper case, digits, punctuation):** only letters change case; other characters pass through — AC-5.
- **Failure of dependency (`greet`):** `shout` has one dependency, `greet`; if `greet`'s output changes, `shout` follows it by definition — AC-3. `greet` cannot fail for string input (`greet.js:2`).
- Zero, expired, concurrent, first-run: not applicable (pure, stateless function).

## Interfaces and contracts

- `shout(name: string) -> string` — new named export of `greet.js`. Returns `upperCase(greet(name))`.
- `greet(name: string) -> string` — unchanged.

## Data and state

None identified.

## Non-functional requirements

None identified.

## Risk areas

- Public contracts: adds one new named export to `greet.js`; additive only, existing `greet` export unchanged (AC-6).
- Auth, money, schema or migrations, PII, deletion: none touched.

## Decisions

- Chose to compute `shout` from `greet(name)` rather than duplicating the `Hello, ` literal, because the request says "the greeting from greet(name)" and this keeps both functions consistent.
- Chose locale-independent upper-casing (the language's default upper-case conversion, not a locale-specific one), because no locale requirement exists and the result is then deterministic across environments.

## Out of scope

- Input validation or type checking of `name` (non-string, `null`, `undefined`); `greet` does not validate either, and `shout` inherits whatever `greet` produces.
- Changes to `greet` itself or its wording.
- Locale-specific casing rules (for example Turkish dotted/dotless i).

## Open questions

None identified.

## Verification approach

Automated unit tests in the existing `node:test` suite (run with `node --test`):

- **AC-1** Import `shout` from `greet.js` and assert it is a function.
- **AC-2** Assert `shout('Ada')` equals `'HELLO, ADA'`.
- **AC-3** For a few sample names (lower, mixed, upper case), assert `shout(n)` equals `greet(n)` upper-cased.
- **AC-4** Assert `shout('')` equals `'HELLO, '`.
- **AC-5** Assert `shout('R2-D2')` equals `'HELLO, R2-D2'`.
- **AC-6** The existing test at `greet.test.js:6` continues to pass.

## Accepted risks

None
