import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../bin/verify-waiver.mjs';

function mkd() {
  const d = join(tmpdir(), 'sdd-vw-' + Math.random().toString(36).slice(2));
  mkdirSync(d, { recursive: true });
  return d;
}

test('verify-waiver does nothing when external is false', () => {
  const d = mkd();
  const r = run([], d);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('nothing to waive'));
});

test('verify-waiver requires a waiver when external is true', () => {
  const d = mkd();
  writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ verify: { external: true, externalCommand: null, waiverFile: '.sdd/verify-waived.txt' } }), 'utf8');
  const r = run([], d);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('unsatisfied'));
});

test('verify-waiver passes when the waiver file exists', () => {
  const d = mkd();
  mkdirSync(join(d, '.sdd'), { recursive: true });
  writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ verify: { external: true, externalCommand: null, waiverFile: '.sdd/verify-waived.txt' } }), 'utf8');
  writeFileSync(join(d, '.sdd', 'verify-waived.txt'), 'ok\n', 'utf8');
  const r = run([], d);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('waived'));
});
