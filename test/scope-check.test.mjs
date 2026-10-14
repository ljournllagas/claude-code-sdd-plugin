import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, countAcceptanceCriteria, checkScope } from '../bin/scope-check.mjs';

function mkd() {
  const d = join(tmpdir(), 'sdd-scope-' + Math.random().toString(36).slice(2));
  mkdirSync(d, { recursive: true });
  return d;
}

test('countAcceptanceCriteria counts unique AC ids', () => {
  assert.equal(countAcceptanceCriteria('**AC-1** x **AC-2** y **AC-1** again'), 2);
});

test('checkScope passes within the default limit', () => {
  const d = mkd();
  const text = '**AC-1** x';
  assert.deepEqual(checkScope(text, d), []);
});

test('checkScope fails beyond the configured limit', () => {
  const d = mkd();
  writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ limits: { maxAcceptanceCriteria: 1 } }), 'utf8');
  const text = '**AC-1** x **AC-2** y';
  assert.deepEqual(checkScope(text, d), ['spec: 2 acceptance criteria (limit 1); split the request before review (playbook section 2)']);
});

test('run CLI returns exit 0 on ok and exit 1 on defect', () => {
  const d = mkd();
  writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ limits: { maxAcceptanceCriteria: 1 } }), 'utf8');
  writeFileSync(join(d, 'spec.md'), '**AC-1** only', 'utf8');
  const ok = run(['spec.md'], d);
  assert.equal(ok.code, 0);
  writeFileSync(join(d, 'spec2.md'), '**AC-1** **AC-2**', 'utf8');
  const bad = run(['spec2.md'], d);
  assert.equal(bad.code, 1);
  assert.ok(bad.stdout.includes('acceptance criteria'));
});

test('run CLI returns exit 2 for missing argument', () => {
  const r = run([], mkd());
  assert.equal(r.code, 2);
});
