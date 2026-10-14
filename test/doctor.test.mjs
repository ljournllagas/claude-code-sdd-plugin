import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../bin/doctor.mjs';

function mkd() {
  const d = join(tmpdir(), 'sdd-doctor-' + Math.random().toString(36).slice(2));
  mkdirSync(d, { recursive: true });
  mkdirSync(join(d, '.sdd'), { recursive: true });
  return d;
}

test('doctor reports no active run when the marker is absent', () => {
  const d = mkd();
  const r = run([], d);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('active run: none'));
});

test('doctor reports issues for a malformed active marker', () => {
  const d = mkd();
  writeFileSync(join(d, '.sdd', 'active.json'), '{not json', 'utf8');
  const r = run([], d);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('unreadable marker'));
});

test('doctor reports a missing plan file', () => {
  const d = mkd();
  const marker = { slug: 'x', lane: 'FULL', stage: 'planning', spec: 'docs/s.md', plan: 'docs/p.md', started: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' };
  writeFileSync(join(d, '.sdd', 'active.json'), JSON.stringify(marker), 'utf8');
  const r = run([], d);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('plan file missing'));
});

test('doctor summarizes a valid active run', () => {
  const d = mkd();
  mkdirSync(join(d, 'docs'), { recursive: true });
  writeFileSync(join(d, 'docs', 's.md'), '## Goal\nx\n', 'utf8');
  writeFileSync(join(d, 'docs', 'p.md'), '---\ntype: plan\nstatus: draft\ntimestamp: 2026-01-01\nlayout: single\n---\n\n# Plan\n\n### T1 — x [ ] pending\nVerify: echo ok\n', 'utf8');
  const now = new Date().toISOString();
  const marker = { slug: 'x', lane: 'FULL', stage: 'executing', spec: 'docs/s.md', plan: 'docs/p.md', started: now, updated: now, slice: { n: 1, total: 1 } };
  writeFileSync(join(d, '.sdd', 'active.json'), JSON.stringify(marker), 'utf8');
  const r = run([], d);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('active run: x'));
  assert.ok(r.stdout.includes('plan tasks: 0/1 done'));
  assert.ok(r.stdout.includes('next: Resume execution'));
});
