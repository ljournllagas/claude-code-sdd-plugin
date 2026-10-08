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
  '# Plan', '**Status:** executing', '',
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
