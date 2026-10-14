import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, checkCitations, findCitations, extractBackground } from '../bin/cite-check.mjs';

function mkd() {
  const d = join(tmpdir(), 'sdd-cite-' + Math.random().toString(36).slice(2));
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'Foo.cs'), 'line1\nline2\nline3\n', 'utf8');
  return d;
}

test('extractBackground returns the section body', () => {
  const bg = extractBackground('## Goal\nx\n\n## Background\nfact Foo.cs:1\n\n## Risk areas\ny\n');
  assert.equal(bg, 'fact Foo.cs:1\n');
});

test('extractBackground returns null when missing', () => {
  assert.equal(extractBackground('## Goal\nx\n'), null);
});

test('findCitations parses a path and a range', () => {
  assert.deepEqual(findCitations('a Foo.cs:2 b Bar.py:10-12'), [
    { path: 'Foo.cs', from: 2, to: 2 },
    { path: 'Bar.py', from: 10, to: 12 },
  ]);
});

test('checkCitations passes for an in-range citation', () => {
  const d = mkd();
  const text = '## Background\nFoo.cs:2 verified.\n';
  assert.deepEqual(checkCitations(text, d), ['ok' /* replaced below */].slice(0,0));
  assert.deepEqual(checkCitations(text, d), []);
});

test('checkCitations fails when the file is missing', () => {
  const d = mkd();
  const text = '## Background\nNope.cs:1 verified.\n';
  assert.deepEqual(checkCitations(text, d), ['spec: unresolved citation: Nope.cs:1 (file not found)']);
});

test('checkCitations fails when the line is out of range', () => {
  const d = mkd();
  const text = '## Background\nFoo.cs:99 verified.\n';
  assert.deepEqual(checkCitations(text, d), ['spec: citation line out of range: Foo.cs:99 (file has 3 lines)']);
});

test('checkCitations fails for an uncited non-empty Background', () => {
  const d = mkd();
  const text = '## Background\nSome unverified claim.\n';
  assert.deepEqual(checkCitations(text, d), ['spec: Background has no file:line citations']);
});

test('checkCitations accepts "None identified"', () => {
  const d = mkd();
  const text = '## Background\nNone identified.\n';
  assert.deepEqual(checkCitations(text, d), []);
});

test('checkCitations fails for a missing Background section', () => {
  const d = mkd();
  const text = '## Goal\nx\n';
  assert.deepEqual(checkCitations(text, d), ['spec: missing "## Background" section']);
});

test('run CLI returns exit 0 on ok and exit 1 on defect', () => {
  const d = mkd();
  writeFileSync(join(d, 'spec.md'), '## Background\nFoo.cs:1\n', 'utf8');
  const ok = run(['spec.md'], d);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), 'ok');

  writeFileSync(join(d, 'spec2.md'), '## Background\nFoo.cs:99\n', 'utf8');
  const bad = run(['spec2.md'], d);
  assert.equal(bad.code, 1);
  assert.ok(bad.stdout.includes('citation line out of range'));
});

test('run CLI returns exit 2 for missing argument', () => {
  const r = run([], mkd());
  assert.equal(r.code, 2);
});
