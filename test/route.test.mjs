import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../bin/route.mjs';

// A project directory whose name contains a space (Review Focus 1).
const mkProj = (cfg, raw) => {
  const d = mkdtempSync(join(tmpdir(), 'sdd proj '));
  if (raw !== undefined) writeFileSync(join(d, 'sdd.config.json'), raw);
  else if (cfg) writeFileSync(join(d, 'sdd.config.json'), JSON.stringify(cfg));
  return d;
};

// ---------- config ----------
test('default config validates with no errors or warnings', () => {
  const { errors, warnings } = R.validateConfig(R.defaultConfig());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('schema top-level properties match the default config keys', () => {
  const schema = JSON.parse(readFileSync(new URL('../config/sdd.config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(R.defaultConfig()).sort());
});

test('loadConfig without a project file returns the defaults', () => {
  const l = R.loadConfig(mkProj());
  assert.equal(l.ok, true);
  assert.deepEqual(l.config, R.defaultConfig());
});

test('project config overrides field by field', () => {
  const l = R.loadConfig(mkProj({ router: { timeoutMs: 123 }, verify: { test: 'run-tests' } }));
  assert.equal(l.ok, true);
  assert.equal(l.config.router.timeoutMs, 123);
  assert.equal(l.config.router.noulThreshold, 0.5);
  assert.equal(l.config.verify.test, 'run-tests');
  assert.equal(l.config.verify.build, null);
});

test('unknown top-level key is a warning, not an error', () => {
  const l = R.loadConfig(mkProj({ foo: 1 }));
  assert.equal(l.ok, true);
  assert.ok(l.warnings.some((w) => w.includes('foo')));
});

const invalid = [
  ['models.ultra', { models: { ultra: 'x' } }],
  ['stageFloors.developer', { stageFloors: { developer: 'mega' } }],
  ['stageFloors.nonstage', { stageFloors: { nonstage: 'light' } }],
  ['fallbackTiers.planner', { fallbackTiers: { planner: 'x' } }],
  ['efforts.light', { efforts: { light: 'extreme' } }],
  ['router.noulThreshold', { router: { noulThreshold: 1.5 } }],
  ['router.confidenceThreshold', { router: { confidenceThreshold: -0.1 } }],
  ['router.timeoutMs', { router: { timeoutMs: 'fast' } }],
  ['router.enabled', { router: { enabled: 'yes' } }],
  ['limits.verifyFailuresPerTier', { limits: { verifyFailuresPerTier: 0 } }],
  ['limits.reviewRounds', { limits: { reviewRounds: 2.5 } }],
  ['riskPaths.auth.minTier', { riskPaths: { auth: { minTier: 'nope' } } }],
  ['verify.build', { verify: { build: 42 } }],
  ['version', { version: 2 }],
  ['guard.ttlHours', { guard: { ttlHours: 0 } }],
];
for (const [field, over] of invalid) {
  test(`invalid config: ${field}`, () => {
    const l = R.loadConfig(mkProj(over));
    assert.equal(l.ok, false);
    assert.ok(l.error.includes(field), l.error);
    assert.ok(l.error.startsWith('sdd.config.json: '));
    assert.ok(!l.error.includes('\n'));
    assert.deepEqual(l.config, R.defaultConfig());
  });
}

test('invalid JSON and non-object JSON are errors', () => {
  assert.match(R.loadConfig(mkProj(null, '{ nope')).error, /invalid JSON/);
  assert.match(R.loadConfig(mkProj(null, '[]')).error, /must be a JSON object/);
});
