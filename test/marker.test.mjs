import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, setPath, delPath, parseValue, countFailure, isRunArtifact, changedPaths } from '../bin/marker.mjs';
import { defaultConfig } from '../bin/route.mjs';
import { mkProject, gitInit, planFiles } from './helpers/project.mjs';

const marker = (d) => JSON.parse(readFileSync(join(d, '.sdd', 'active.json'), 'utf8'));

test('dotted paths set, read and delete nested values', () => {
  const o = {};
  setPath(o, 'tasks.T3.in_progress', true);
  setPath(o, 'slice.n', 2);
  assert.deepEqual(o, { tasks: { T3: { in_progress: true } }, slice: { n: 2 } });
  delPath(o, 'tasks.T3');
  assert.deepEqual(o.tasks, {});
});

test('values are JSON when they parse, otherwise strings', () => {
  assert.equal(parseValue('true'), true);
  assert.equal(parseValue('null'), null);
  assert.deepEqual(parseValue('{"n":1,"total":2}'), { n: 1, total: 2 });
  assert.equal(parseValue('executing'), 'executing');
  assert.equal(parseValue('docs/sdd/specs/x.md'), 'docs/sdd/specs/x.md');
});

test('init, set, push, del and fail keep the marker whole and refresh updated', () => {
  const d = mkProject();
  assert.equal(run(['init', '20261015-demo', 'FULL'], d).code, 0);
  const m0 = marker(d);
  assert.deepEqual(Object.keys(m0), ['slug', 'lane', 'stage', 'base', 'dirty_at_start', 'spec', 'plan', 'started', 'updated', 'tasks']);
  assert.equal(run(['set', 'stage=executing', 'slice={"n":1,"total":1}', 'tasks.T1.attempt_tier=standard'], d).code, 0);
  assert.equal(run(['push', 'kept', 'src/x.js', 'src/x.js', 'src/y.js'], d).code, 0);
  const m1 = marker(d);
  assert.equal(m1.stage, 'executing');
  assert.deepEqual(m1.slice, { n: 1, total: 1 });
  assert.deepEqual(m1.kept, ['src/x.js', 'src/y.js']);
  assert.ok(m1.updated >= m0.updated);
  const f = run(['fail', 'T1'], d);
  assert.equal(f.stdout.trim(), 'T1: 1 failure(s) at standard');
  assert.deepEqual(marker(d).tasks.T1, { attempt_tier: 'standard', last_tier: 'standard', failures_at_last_tier: 1, in_progress: false });
  assert.equal(run(['del', 'kept', 'slice'], d).code, 0);
  assert.ok(!('kept' in marker(d)) && !('slice' in marker(d)));
});

test('failure counting keeps an existing last_tier and needs an entry', () => {
  const m = { tasks: { T1: { attempt_tier: 'deep', last_tier: 'deep', failures_at_last_tier: 1, in_progress: true } } };
  assert.equal(countFailure(m, 'T1').failures_at_last_tier, 2);
  assert.throws(() => countFailure(m, 'T9'), /no entry/);
});

test('mutations without a marker, or malformed, fail clearly', () => {
  const d = mkProject();
  assert.equal(run(['set', 'stage=x'], d).code, 1);
  assert.equal(run(['bogus'], d).code, 2);
  run(['init', 's', 'QUICK'], d);
  assert.equal(run(['set', 'no-equals'], d).code, 2);
  assert.equal(run(['init', 's', 'MEDIUM'], d).code, 2);
});

test('baseline records base and dirty paths, excluding run artifacts; none outside git', () => {
  const plain = mkProject();
  run(['init', 's', 'QUICK'], plain);
  assert.equal(run(['baseline'], plain).code, 0);
  assert.equal(marker(plain).base, 'none');
  assert.deepEqual(marker(plain).dirty_at_start, []);

  const d = gitInit(mkProject({ 'src/a.js': 'a\n' }));
  writeFileSync(join(d, 'src', 'a.js'), 'changed\n');
  mkdirSync(join(d, 'docs', 'sdd', 'specs'), { recursive: true });
  writeFileSync(join(d, 'docs', 'sdd', 'specs', 's.md'), 'x\n');
  writeFileSync(join(d, 'new file.txt'), 'n\n');
  run(['init', 's', 'FULL'], d);
  run(['baseline', '--dirty'], d);
  assert.equal(marker(d).base, null);
  assert.deepEqual(marker(d).dirty_at_start.sort(), ['new file.txt', 'src/a.js']);
  run(['baseline', '--base'], d);
  assert.match(marker(d).base, /^[0-9a-f]{40}$/);
});

test('changed paths are relative to the project even below the repository root', () => {
  const repo = gitInit(mkProject({ 'app/src/a.js': 'a\n', 'other.txt': 'o\n' }));
  writeFileSync(join(repo, 'app', 'src', 'a.js'), 'b\n');
  writeFileSync(join(repo, 'other.txt'), 'p\n');
  assert.deepEqual(changedPaths(join(repo, 'app')).sort(), ['../other.txt', 'src/a.js']);
});

test('run artifacts follow the configured paths', () => {
  const cfg = defaultConfig();
  for (const p of ['.sdd/active.json', 'CONTEXT.md', 'sdd.config.json', 'docs/sdd/specs/a.md', 'docs/sdd/plans/a/T1.md', 'docs/sdd/index.md', 'docs/sdd/index.md.123.tmp']) {
    assert.ok(isRunArtifact(p, cfg), p);
  }
  for (const p of ['src/a.js', 'docs/readme.md', 'CONTEXT.md.bak']) assert.ok(!isRunArtifact(p, cfg), p);
});

test('preflight lists a task file with uncommitted changes, minus kept paths', () => {
  const d = gitInit(mkProject({ ...planFiles(), 'src/a.js': 'a\n' }));
  run(['init', 's', 'FULL'], d);
  assert.equal(run(['preflight', 'docs/sdd/plans/demo.md', '--slice', '1'], d).stdout.trim(), 'ok');
  writeFileSync(join(d, 'src', 'a.js'), 'dirty\n');
  const r = run(['preflight', 'docs/sdd/plans/demo.md', '--tasks', 'T1'], d);
  assert.equal(r.code, 1);
  assert.equal(r.stdout.trim(), 'dirty: src/a.js');
  run(['push', 'kept', 'src/a.js'], d);
  assert.equal(run(['preflight', 'docs/sdd/plans/demo.md', '--slice', '1'], d).code, 0);
});
