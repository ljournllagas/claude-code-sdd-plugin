import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, markDone } from '../bin/task-done.mjs';
import { run as marker } from '../bin/marker.mjs';
import { mkProject, gitInit, planFiles, sh } from './helpers/project.mjs';

const ROUTED = '{"attempt_tier":"standard","in_progress":false,"routed":{"source":"fallback","reason":"no key"}}';
const outcomes = (d) => {
  const f = join(d, '.sdd', 'decisions.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.kind === 'outcome') : [];
};

function started(files = {}) {
  const d = gitInit(mkProject({ ...planFiles(), ...files }));
  marker(['init', 's', 'FULL'], d);
  marker(['baseline'], d);
  marker(['set', `tasks.T1=${ROUTED}`], d);
  return d;
}

test('markDone rewrites only the heading of the named task, keeping line endings', () => {
  const d = mkProject({ 't.md': '### T1 — A   [ ] pending\r\n```\n### T1 — A   [ ] pending\n```\r\nVerify: x\r\n' });
  assert.ok(markDone(join(d, 't.md'), 'T1'));
  assert.equal(readFileSync(join(d, 't.md'), 'utf8'), '### T1 — A   [x] done\r\n```\r\n### T1 — A   [ ] pending\r\n```\r\nVerify: x\r\n');
  assert.ok(!markDone(join(d, 't.md'), 'T7'));
});

test('a finished task is marked, committed alone with its Commit line, and logged as a first-attempt pass', () => {
  const d = started({ 'notes.txt': 'user work\n' });
  writeFileSync(join(d, 'notes.txt'), 'still the user\'s uncommitted work\n');
  marker(['baseline', '--dirty'], d);
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'a.js'), 'export const a = 1;\n');
  const r = run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1', '--duration-ms', '1200', '--agent-tokens', '3400'], d);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^done T1 · commit [0-9a-f]+ add a\n$/);
  assert.ok(readFileSync(join(d, 'docs/sdd/plans/demo/T1.md'), 'utf8').startsWith('### T1 — Add a   [x] done'));
  assert.equal(sh(d, 'log', '-1', '--format=%s').stdout.trim(), 'add a');
  assert.equal(sh(d, 'show', '--name-only', '--format=', 'HEAD').stdout.trim(), 'src/a.js');
  assert.match(sh(d, 'status', '--porcelain').stdout, /notes\.txt/, 'the user\'s work stays uncommitted');
  const [o] = outcomes(d);
  assert.deepEqual({ task: o.task, result: o.result, first_attempt: o.first_attempt, tier: o.tier, duration_ms: o.duration_ms, agent_tokens: o.agent_tokens },
    { task: 'T1', result: 'pass', first_attempt: true, tier: 'standard', duration_ms: 1200, agent_tokens: 3400 });
});

test('leftover edits stop before any commit or outcome; after Keep the same command commits', () => {
  const d = started();
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'a.js'), 'a\n');
  writeFileSync(join(d, 'stray.js'), 's\n');
  const head = sh(d, 'rev-parse', 'HEAD').stdout;
  const r = run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1'], d);
  assert.equal(r.code, 3);
  assert.equal(r.stdout.trim(), 'leftover: stray.js');
  assert.equal(sh(d, 'rev-parse', 'HEAD').stdout, head);
  assert.equal(outcomes(d).length, 0);
  marker(['push', 'kept', 'stray.js'], d);
  const again = run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1'], d);
  assert.equal(again.code, 0, again.stdout);
  assert.equal(outcomes(d).length, 1);
});

test('nothing changed means no commit; --no-outcome writes no line; a retry is not a first attempt', () => {
  const d = started({ 'src/a.js': 'a\n' });
  marker(['set', 'tasks.T1.last_tier=standard', 'tasks.T1.failures_at_last_tier=1'], d);
  const r = run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1'], d);
  assert.match(r.stdout, /no commit: none of its files changed/);
  assert.equal(outcomes(d)[0].first_attempt, false);
  const d2 = started({ 'src/a.js': 'a\n' });
  run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1', '--no-outcome'], d2);
  assert.equal(outcomes(d2).length, 0);
});

test('outside git the task is marked and logged without a commit', () => {
  const d = mkProject(planFiles());
  marker(['init', 's', 'FULL'], d);
  marker(['set', `tasks.T1=${ROUTED}`], d);
  const r = run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1'], d);
  assert.equal(r.stdout.trim(), 'done T1 · no commit (not a git repository)');
  assert.equal(outcomes(d).length, 1);
});

test('bad invocations exit 2', () => {
  const d = started();
  assert.equal(run(['--task', 'T1'], d).code, 2);
  assert.equal(run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T9'], d).code, 2);
  assert.equal(run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1', '--duration-ms', 'soon'], d).code, 2);
});
