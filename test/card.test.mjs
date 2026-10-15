import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, planCard, recordAttempt } from '../bin/card.mjs';
import { run as marker } from '../bin/marker.mjs';
import { loadPlan } from '../bin/plan.mjs';
import { mkProject, planFiles } from './helpers/project.mjs';

const NO_KEY = { env: {} };
const readMarker = (d) => JSON.parse(readFileSync(join(d, '.sdd', 'active.json'), 'utf8'));
const decision = (r) => JSON.parse(r.stdout);

test('a developer card comes from the task: summary, Files, dependency counts', () => {
  const d = mkProject(planFiles());
  const plan = loadPlan(join(d, 'docs/sdd/plans/demo.md'));
  assert.deepEqual(planCard('developer', plan, { task: 'T1' }), {
    stage: 'developer', summary: 'Add the a module.', paths: ['src/a.js'], files_touched: 1, tasks_upstream: 0, tasks_downstream: 1,
  });
  assert.deepEqual(planCard('developer', plan, { task: 'T2' }).tasks_upstream, 1);
});

test('an EXPAND card carries the batch summaries; a plan-review card the scope files', () => {
  const d = mkProject(planFiles());
  const plan = loadPlan(join(d, 'docs/sdd/plans/demo.md'));
  const p = planCard('planner', plan, { tasks: ['T1', 'T2'] });
  assert.equal(p.summary, 'Write the task files for: Add the a module. Change the a module and add b.');
  assert.deepEqual(p.paths, ['src/a.js', 'src/b.js']);
  assert.equal(p.files_touched, 2);
  const r = planCard('reviewer-plan', plan, { slice: 1 });
  assert.equal(r.summary, 'Review the plan for: Demo');
  assert.equal(r.files_touched, 2);
  assert.throws(() => planCard('analyst', plan, {}), /takes --summary/);
});

test('routing with --record writes the attempt entry (§7.3 step 2)', async () => {
  const d = mkProject(planFiles());
  marker(['init', 's', 'FULL'], d);
  const r = await run(['--stage', 'developer', '--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1', '--record', 'T1'], d, NO_KEY);
  assert.equal(r.code, 0, r.stderr);
  const dec = decision(r);
  assert.equal(dec.source, 'fallback');
  assert.equal(dec.tier, 'standard');
  assert.deepEqual(readMarker(d).tasks.T1, { attempt_tier: 'standard', in_progress: true, routed: { source: 'fallback', reason: 'no key' } });
  const log = readFileSync(join(d, '.sdd', 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.at(-1).card.summary, 'Add the a module.');
});

test('--retry escalates from the marker counters and resets them on a higher tier', async () => {
  const d = mkProject(planFiles());
  marker(['init', 's', 'FULL'], d);
  marker(['set', 'tasks.T1={"attempt_tier":"standard","last_tier":"standard","failures_at_last_tier":2,"in_progress":false}'], d);
  const r = await run(['--stage', 'developer', '--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1', '--retry', 'T1', '--record', 'T1'], d, NO_KEY);
  const dec = decision(r);
  assert.equal(dec.tier, 'deep');
  assert.equal(dec.source, 'escalation');
  const e = readMarker(d).tasks.T1;
  assert.equal(e.last_tier, 'deep');
  assert.equal(e.failures_at_last_tier, 0);
  assert.equal(e.attempt_tier, 'deep');
  assert.equal(e.in_progress, true);
});

test('a human decision is printed but never recorded', async () => {
  const d = mkProject(planFiles());
  marker(['init', 's', 'FULL'], d);
  const entry = { attempt_tier: 'deep', last_tier: 'deep', failures_at_last_tier: 2, in_progress: false };
  marker(['set', `tasks.T1=${JSON.stringify(entry)}`], d);
  const r = await run(['--stage', 'developer', '--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1', '--retry', 'T1', '--record', 'T1'], d, NO_KEY);
  assert.equal(decision(r).human, true);
  assert.deepEqual(readMarker(d).tasks.T1, entry);
});

test('--resume re-routes a lost attempt at its recorded tier without counting it', async () => {
  const d = mkProject(planFiles());
  marker(['init', 's', 'FULL'], d);
  marker(['set', 'tasks.T1={"attempt_tier":"standard","in_progress":true,"routed":{"source":"fallback","reason":"no key"}}'], d);
  const r = await run(['--stage', 'developer', '--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1', '--resume', 'T1', '--record', 'T1'], d, NO_KEY);
  assert.equal(decision(r).tier, 'standard');
  const e = readMarker(d).tasks.T1;
  assert.ok(!('last_tier' in e));
  assert.equal(e.routed.source, 'escalation');
});

test('free-text stages take --summary and --paths; bad flags exit 2', async () => {
  const d = mkProject();
  const r = await run(['--stage', 'triage', '--summary', 'Add a farewell function', '--paths', 'src/greet.js', '--files-touched', '1'], d, NO_KEY);
  assert.equal(decision(r).lane, 'QUICK');
  const risky = await run(['--stage', 'triage', '--summary', 'Refund a payment', '--files-touched', '1'], d, NO_KEY);
  assert.equal(decision(risky).lane, 'FULL');
  assert.equal((await run(['--stage', 'nope'], d, NO_KEY)).code, 2);
  assert.equal((await run(['--stage', 'developer', '--bogus', 'x'], d, NO_KEY)).code, 2);
  assert.equal((await run(['--stage', 'developer', '--summary', 'x', '--record', 'T1'], d, NO_KEY)).code, 2, 'record needs a marker');
});

test('recordAttempt keeps counters when the tier does not rise', () => {
  const m = { tasks: { T1: { attempt_tier: 'standard', last_tier: 'standard', failures_at_last_tier: 1, in_progress: false } } };
  recordAttempt(m, 'T1', { tier: 'standard', source: 'escalation', reason: 'retry' });
  assert.deepEqual(m.tasks.T1, { attempt_tier: 'standard', last_tier: 'standard', failures_at_last_tier: 1, in_progress: true, routed: { source: 'escalation', reason: 'retry' } });
});
