import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, verifyCommands, quickCommands, tail, runCommand } from '../bin/verify.mjs';
import { run as marker } from '../bin/marker.mjs';
import { mkProject, planFiles } from './helpers/project.mjs';

const node = (code) => `node -e "${code}"`;
const NOISY_FAIL = node("for (let i = 1; i <= 100; i++) console.log('line ' + i); console.error('boom'); process.exit(3)");

test('Verify lines yield their commands; Manual lines yield null', () => {
  assert.deepEqual(verifyCommands('`npm run build`, `npm test` → expected: both pass'), ['npm run build', 'npm test']);
  assert.deepEqual(verifyCommands('node --test → expected: passes'), ['node --test']);
  assert.deepEqual(verifyCommands('make check -> expected: ok'), ['make check']);
  assert.equal(verifyCommands('Manual: open the page and click Save'), null);
  assert.deepEqual(verifyCommands(''), []);
});

test('the QUICK set is build, test, lint, typecheck in order, never format', () => {
  assert.deepEqual(quickCommands({ build: 'b', test: 't', lint: null, typecheck: 'tc', format: 'f' }), ['b', 't', 'tc']);
});

test('tail keeps the last lines', () => {
  assert.equal(tail('a\nb\nc\n\n', 2), 'b\nc');
});

test('a command runs from the project directory with stdout and stderr in order', () => {
  const d = mkProject({ 'here.txt': 'x' });
  const r = runCommand(node("console.log(require('fs').existsSync('here.txt')); console.error('err'); console.log('out')"), d);
  assert.ok(r.ok);
  assert.equal(r.output.trim(), 'true\nerr\nout');
});

test('a pass prints one line; a failure writes the last 40 lines to the task\'s failure file', () => {
  const d = mkProject();
  marker(['init', '20261015-demo', 'FULL'], d);
  const ok = run(['--cmd', node('process.exit(0)'), '--cmd', node('process.exit(0)')], d);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout, 'pass: 2 command(s)\n');
  const bad = run(['--key', 'T1', '--cmd', node('process.exit(0)'), '--cmd', NOISY_FAIL, '--cmd', node('process.exit(0)')], d);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /^fail: .* \(exit 3\); last 40 lines in \.sdd\/review\/20261015-demo-T1\.fail\.txt\n$/);
  const saved = readFileSync(join(d, '.sdd', 'review', '20261015-demo-T1.fail.txt'), 'utf8').trimEnd().split('\n');
  assert.equal(saved.length, 40);
  assert.equal(saved[0], 'line 62');
  assert.equal(saved.at(-1), 'boom');
});

test('without --key a failure prints its tail for the caller (the developer\'s runner)', () => {
  const r = run(['--cmd', NOISY_FAIL], mkProject());
  assert.equal(r.code, 1);
  const lines = r.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 41);
  assert.equal(lines.at(-1), 'boom');
});

test('a task\'s Verify line is read from the plan; Manual tasks exit 4', () => {
  const d = mkProject(planFiles('Manual: open the app and check a'));
  assert.equal(run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T2'], d).stdout, 'pass: 1 command(s)\n');
  const m = run(['--manifest', 'docs/sdd/plans/demo.md', '--task', 'T1'], d);
  assert.equal(m.code, 4);
  assert.equal(m.stdout, 'manual: open the app and check a\n');
});

test('--quick runs the configured set; an empty set exits 3', () => {
  const d = mkProject();
  assert.equal(run(['--quick'], d).code, 3);
  writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ version: 1, verify: { test: node('process.exit(0)'), format: node('process.exit(9)') } }));
  assert.equal(run(['--quick'], d).stdout, 'pass: 1 command(s)\n');
});

test('external verification: waived, by command, or missing', () => {
  const d = mkProject();
  marker(['init', 's', 'QUICK'], d);
  const cfg = (verify) => writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ version: 1, verify: { test: node('process.exit(0)'), external: true, ...verify } }));
  cfg({});
  const missing = run(['--quick', '--key', 'quick'], d);
  assert.equal(missing.code, 1);
  assert.match(readFileSync(join(d, '.sdd', 'review', 's-quick.fail.txt'), 'utf8'), /verify-waived\.txt/);
  cfg({ externalCommand: node('process.exit(0)') });
  assert.equal(run(['--quick'], d).stdout, 'pass: 1 command(s) · external: passed\n');
  cfg({ externalCommand: node('process.exit(2)') });
  assert.match(run(['--quick'], d).stdout, /^fail: external: /);
  mkdirSync(join(d, '.sdd'), { recursive: true });
  writeFileSync(join(d, '.sdd', 'verify-waived.txt'), 'ran on the device lab\n');
  assert.equal(run(['--quick'], d).stdout, 'pass: 1 command(s) · external: waived (.sdd/verify-waived.txt)\n');
  assert.ok(existsSync(join(d, '.sdd', 'verify-waived.txt')));
});

test('bad invocations exit 2', () => {
  const d = mkProject(planFiles());
  assert.equal(run([], d).code, 2);
  assert.equal(run(['--quick', '--cmd', 'x'], d).code, 2);
  assert.equal(run(['--manifest', 'docs/sdd/plans/demo.md'], d).code, 2);
  assert.equal(run(['--cmd', 'x', '--key', 'T1'], d).code, 2, '--key needs a marker');
});
