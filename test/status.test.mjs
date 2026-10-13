import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../bin/status.mjs';

const STATUS = fileURLToPath(new URL('../bin/status.mjs', import.meta.url));

const PLAN = [
  '---', 'type: plan', 'title: Plan', 'status: executing', '---', '', '# Plan', '',
  '### T1 — Add the helper   [x] done',
  '### T2 — Wire the helper   [ ] pending',
  '### T3 — Update docs [with brackets]   [!] blocked',
  '### T4 — Skipped one   [!] skipped',
  'Not a heading: ### T9 — nope   [x] done',
  '### T5 — Plain marker only [x]',
].join('\n');

test('parsePlanTasks reads id, title and marker', () => {
  assert.deepEqual(S.parsePlanTasks(PLAN), [
    { id: 'T1', title: 'Add the helper', marker: 'x' },
    { id: 'T2', title: 'Wire the helper', marker: ' ' },
    { id: 'T3', title: 'Update docs [with brackets]', marker: '!' },
    { id: 'T4', title: 'Skipped one', marker: '!' },
    { id: 'T5', title: 'Plain marker only', marker: 'x' },
  ]);
  assert.deepEqual(S.parsePlanTasks('no tasks'), []);
});

const e = (tier, source, usage = null) => JSON.stringify({ ts: 't', card: { stage: 'developer' }, decision: { tier, source }, usage, answers: null });

test('summarizeLog counts tiers, sources, escalations, fallback share and tokens; skips bad lines (Review Focus 3)', () => {
  const text = [
    e('light', 'typesafe', { input_tokens: 1400, output_tokens: 300 }),
    e('standard', 'fallback'),
    e('standard', 'escalation'),
    e('deep', 'human'),
    '',
    '{"ts":"2026-10',
  ].join('\n');
  const s = S.summarizeLog(text);
  assert.equal(s.total, 4);
  assert.deepEqual(s.byTier, { light: 1, standard: 2, deep: 1 });
  assert.deepEqual(s.bySource, { typesafe: 1, fallback: 1, escalation: 1, human: 1 });
  assert.equal(s.escalations, 1);
  assert.equal(s.fallbackShare, 0.25);
  assert.equal(s.inputTokens, 1400);
  assert.equal(s.outputTokens, 300);
  assert.equal(s.skipped, 1);
  assert.equal(S.summarizeLog('').total, 0);
});

test('formatStatus: active FULL run with task progress and decision summary', () => {
  const out = S.formatStatus({
    active: { slug: 'add-greeting', lane: 'FULL', stage: 'executing' },
    tasks: S.parsePlanTasks(PLAN),
    summary: S.summarizeLog([e('light', 'typesafe', { input_tokens: 1400, output_tokens: 300 }), e('standard', 'fallback'), '{"bad'].join('\n')),
  });
  assert.ok(out.includes('Active run: add-greeting · lane FULL · stage executing · task 2/5'), out);
  assert.ok(out.includes('Decisions: 2 delegations'));
  assert.ok(out.includes('by tier:   light 1 · standard 1 · deep 0'));
  assert.ok(out.includes('by source: typesafe 1 · fallback 1 · escalation 0 · human 0'));
  assert.ok(out.includes('escalations: 0'));
  assert.ok(out.includes('fallback share: 50%'));
  assert.ok(out.includes('TypeSafe tokens: 1,400 in / 300 out'));
  assert.ok(out.includes('1 unreadable log line skipped'));
});

test('formatStatus: no run, no log; QUICK run; FULL run with missing plan', () => {
  const none = S.formatStatus({ active: null, tasks: null, summary: S.summarizeLog('') });
  assert.ok(none.includes('No active run.'));
  assert.ok(none.includes('No decisions logged yet.'));
  const quick = S.formatStatus({ active: { slug: 'q', lane: 'QUICK', stage: 'quick-dev' }, tasks: null, summary: S.summarizeLog('') });
  assert.ok(quick.includes('Active run: q · lane QUICK · stage quick-dev'));
  assert.ok(!quick.includes('task '));
  const noPlan = S.formatStatus({ active: { slug: 'f', lane: 'FULL', stage: 'plan-draft' }, tasks: null, summary: S.summarizeLog('') });
  assert.ok(noPlan.includes('task ?/?'));
});

test('CLI reads marker, plan and log from the project (path with a space)', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd status '));
  mkdirSync(join(d, '.sdd'));
  mkdirSync(join(d, 'docs', 'sdd', 'plans'), { recursive: true });
  writeFileSync(join(d, 'docs', 'sdd', 'plans', 'p.md'), PLAN);
  writeFileSync(join(d, '.sdd', 'active.json'), JSON.stringify({ slug: 'p', lane: 'FULL', stage: 'executing', plan: 'docs/sdd/plans/p.md', updated: new Date().toISOString() }));
  writeFileSync(join(d, '.sdd', 'decisions.jsonl'), e('light', 'typesafe') + '\n');
  const r = spawnSync(process.execPath, [STATUS], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Active run: p · lane FULL · stage executing · task 2/5'));
  assert.ok(r.stdout.includes('Decisions: 1 delegations'));
});

test('CLI with no files prints the empty report; with an invalid config exits 1', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd status '));
  const empty = spawnSync(process.execPath, [STATUS], { cwd: d, encoding: 'utf8' });
  assert.equal(empty.status, 0);
  assert.ok(empty.stdout.includes('No active run.'));
  writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ limits: { reviewRounds: 0 } }));
  const bad = spawnSync(process.execPath, [STATUS], { cwd: d, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.ok(bad.stderr.includes('limits.reviewRounds'));
});

// ---------- v0.3: split plans ----------
const SPLIT_MANIFEST = [
  '---', 'type: plan', 'title: Split', 'status: executing', 'layout: split', '---', '', '**Task count:** 3', '',
  '## Slices', '', '- Slice 1 — Core', '- Slice 2 — Docs', '',
  '## Task index', '',
  '- T1 — One · slice 1 · ACs: AC-1 · deps: none · files: `a`', '  summary: One.',
  '- T2 — Two · slice 1 · ACs: AC-2 · deps: T1 · files: `b`', '  summary: Two.',
  '- T3 — Three · slice 2 · ACs: AC-3 · deps: T2 · files: `c`', '  summary: Three.', '',
].join('\n');

test('formatStatus: slice position and expanded count appear for a split plan; legacy output is unchanged', () => {
  const tasks = [{ id: 'T1', title: 'a', marker: 'x' }, { id: 'T2', title: 'b', marker: ' ' }, { id: 'T3', title: 'c', marker: ' ' }];
  const out = S.formatStatus({
    active: { slug: 's', lane: 'FULL', stage: 'plan-draft', slice: { n: 2, total: 3 } }, tasks, expanded: 2, summary: S.summarizeLog(''),
  });
  assert.ok(out.includes('Active run: s · lane FULL · stage plan-draft · slice 2/3 · task 1/3 (2 expanded)'), out);
  const legacy = S.formatStatus({ active: { slug: 's', lane: 'FULL', stage: 'executing' }, tasks, summary: S.summarizeLog('') });
  assert.ok(legacy.includes('stage executing · task 1/3\n'), legacy);
  assert.ok(!legacy.includes('slice') && !legacy.includes('expanded'));
});

test('CLI reads a split plan: markers come from task files, unexpanded tasks are counted', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd status '));
  mkdirSync(join(d, '.sdd'));
  const plans = join(d, 'docs', 'sdd', 'plans');
  mkdirSync(join(plans, 'p'), { recursive: true });
  writeFileSync(join(plans, 'p.md'), SPLIT_MANIFEST);
  writeFileSync(join(plans, 'p', 'T1.md'), '### T1 — One   [x] done\nVerify: x\n');
  writeFileSync(join(plans, 'p', 'T2.md'), '### T2 — Two   [ ] pending\nVerify: x\n');
  writeFileSync(join(d, '.sdd', 'active.json'), JSON.stringify({ slug: 'p', lane: 'FULL', stage: 'executing', plan: 'docs/sdd/plans/p.md', slice: { n: 1, total: 2 }, updated: new Date().toISOString() }));
  const r = spawnSync(process.execPath, [STATUS], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Active run: p · lane FULL · stage executing · slice 1/2 · task 1/3 (2 expanded)'), r.stdout);
});

// ---------- outcome lines (spec 2026-10-13-sdd-outcome-logging, AC-17 to AC-20) ----------
const oc = (o = {}) => JSON.stringify({
  ts: '2026-10-13T08:00:00.000Z', kind: 'outcome', stage: 'developer', slug: 's', task: 'T1', first_attempt: true, tier: 'standard',
  source: 'typesafe', reason: 'complexity 1.4 → standard', result: 'pass', duration_ms: null, agent_tokens: null, ...o,
});
const BUMPED = 'complexity 1.4 → standard; ambiguous 0.71 → +1 → deep';
const OUTCOME_LOG = [
  e('light', 'typesafe'),
  e('standard', 'escalation'),
  oc({ reason: BUMPED, tier: 'deep', result: 'pass', duration_ms: 60000, agent_tokens: 1000 }),
  oc({ tier: 'standard', result: 'fail', duration_ms: 120000 }),
  oc({ tier: 'light', result: 'pass', agent_tokens: 500 }),
  oc({ first_attempt: false, tier: 'deep', source: 'escalation', reason: 'retry at same tier (1/2 failures at deep)', result: 'pass', duration_ms: 30000, agent_tokens: 2000 }),
  oc({ tier: 'deep', source: 'fallback', reason: 'timeout', result: 'pass' }),
  oc({ result: 'blocked', duration_ms: 0, agent_tokens: 0 }),
  oc({ tier: 'ultra' }),
].join('\n');

test('summarizeLog: outcome lines are counted apart from decisions; a malformed one is unreadable', () => {
  const s = S.summarizeLog(OUTCOME_LOG);
  assert.equal(s.total, 2);
  assert.equal(s.skipped, 1);
  const o = s.outcomes;
  assert.equal(o.total, 6);
  assert.deepEqual(o.byResult, { pass: 4, fail: 1, blocked: 1 });
  assert.deepEqual(o.firstAttempt, { pass: 3, fail: 1 });
  assert.deepEqual(o.firstAttemptByTier, { light: { pass: 1, fail: 0 }, standard: { pass: 0, fail: 1 }, deep: { pass: 2, fail: 0 } });
  assert.deepEqual(o.bump, { fired: { pass: 1, fail: 0 }, notFired: { pass: 1, fail: 1 } });
  assert.equal(o.durationMs, 210000);
  assert.equal(o.durationCount, 4);
  assert.equal(o.agentTokens, 3500);
  assert.equal(o.tokensCount, 4);
});

test('summarizeLog: the bump token is a standalone +1, not any plus sign', () => {
  const s = S.summarizeLog([
    oc({ reason: 'risk auth+money → standard', result: 'pass' }),
    oc({ reason: 'x +1 → deep', result: 'pass' }),
    oc({ reason: '+1', result: 'fail' }),
    oc({ reason: 'cost +10 units', result: 'fail' }),
  ].join('\n'));
  assert.deepEqual(s.outcomes.bump, { fired: { pass: 1, fail: 1 }, notFired: { pass: 1, fail: 1 } });
});

test('summarizeLog: a log with no outcome lines has zeroed outcomes', () => {
  const s = S.summarizeLog(e('light', 'typesafe'));
  assert.equal(s.outcomes.total, 0);
  assert.deepEqual(s.outcomes.firstAttempt, { pass: 0, fail: 0 });
});

test('formatStatus: the Outcomes block, exactly', () => {
  const out = S.formatStatus({ active: null, tasks: null, summary: S.summarizeLog(OUTCOME_LOG) });
  assert.equal(out, [
    'No active run.',
    'Decisions: 2 delegations',
    '  by tier:   light 1 · standard 1 · deep 0',
    '  by source: typesafe 1 · fallback 0 · escalation 1 · human 0',
    '  escalations: 1',
    '  fallback share: 0%',
    '  TypeSafe tokens: 0 in / 0 out',
    'Outcomes: 6 attempts · pass 4 · fail 1 · blocked 1',
    '  first attempt: 3/4 passed (75%) · light 1/1 · standard 0/1 · deep 2/2',
    '  bump fired: 1/1 passed · no bump: 1/2 passed (first attempt, TypeSafe)',
    '  agent tokens: 3,500 over 4 attempts · duration: 3m 30s over 4 attempts',
    '  (1 unreadable log line skipped)',
    '',
  ].join('\n'));
});

test('formatStatus: zero denominators print n/a, the cost line is dropped, singular is used', () => {
  const none = S.formatStatus({ active: null, tasks: null, summary: S.summarizeLog([oc({ result: 'blocked' }), oc({ first_attempt: false, result: 'pass' })].join('\n')) });
  assert.equal(none, [
    'No active run.', 'No decisions logged yet.',
    'Outcomes: 2 attempts · pass 1 · fail 0 · blocked 1',
    '  first attempt: n/a',
    '  bump fired: n/a · no bump: n/a (first attempt, TypeSafe)',
    '',
  ].join('\n'));
  const one = S.formatStatus({ active: null, tasks: null, summary: S.summarizeLog(oc({ duration_ms: 3600000, agent_tokens: 10 })) });
  assert.ok(one.includes('Outcomes: 1 attempt · pass 1 · fail 0 · blocked 0\n'), one);
  assert.ok(one.includes('  first attempt: 1/1 passed (100%) · standard 1/1\n'), one);
  assert.ok(one.includes('  agent tokens: 10 over 1 attempt · duration: 1h 00m over 1 attempt\n'), one);
});

test('formatStatus: durations truncate; only the count that reported is shown', () => {
  const t = (ms) => S.formatStatus({ active: null, tasks: null, summary: S.summarizeLog(oc({ duration_ms: ms })) });
  assert.ok(t(0).includes('duration: 0m 00s over 1 attempt'));
  assert.ok(t(59999).includes('duration: 0m 59s'));
  assert.ok(t(3599999).includes('duration: 59m 59s'));
  assert.ok(t(7384000).includes('duration: 2h 03m'));
  assert.ok(!t(1000).includes('agent tokens'));
});

test('formatStatus: a log with no outcome lines is exactly the pre-outcome output', () => {
  const summary = S.summarizeLog([e('light', 'typesafe', { input_tokens: 1400, output_tokens: 300 }), e('standard', 'fallback'), '{"bad'].join('\n'));
  assert.equal(S.formatStatus({ active: null, tasks: null, summary }), [
    'No active run.',
    'Decisions: 2 delegations',
    '  by tier:   light 1 · standard 1 · deep 0',
    '  by source: typesafe 1 · fallback 1 · escalation 0 · human 0',
    '  escalations: 0',
    '  fallback share: 50%',
    '  TypeSafe tokens: 1,400 in / 300 out',
    '  (1 unreadable log line skipped)',
    '',
  ].join('\n'));
});

test('CLI shows the Outcomes block from the project log', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd status '));
  mkdirSync(join(d, '.sdd'));
  writeFileSync(join(d, '.sdd', 'decisions.jsonl'), [e('light', 'typesafe'), oc({ result: 'fail' })].join('\n') + '\n');
  const r = spawnSync(process.execPath, [STATUS], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Outcomes: 1 attempt · pass 0 · fail 1 · blocked 0'), r.stdout);
  assert.ok(r.stdout.includes('first attempt: 0/1 passed (0%) · standard 0/1'), r.stdout);
});
