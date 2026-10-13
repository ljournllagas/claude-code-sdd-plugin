import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../bin/route.mjs';
import { encodeResponse, fixtureRequest, fixtureResponse } from './helpers/typesafe-mock.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMock, json } from './helpers/typesafe-mock.mjs';

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
  assert.ok(l.warnings.some((w) => w.startsWith('sdd.config.json: ') && w.includes('foo')));
});

test('paths.index defaults to docs/sdd/index.md and is in the schema', () => {
  assert.equal(R.defaultConfig().paths.index, 'docs/sdd/index.md');
  const schema = JSON.parse(readFileSync(new URL('../config/sdd.config.schema.json', import.meta.url), 'utf8'));
  assert.ok('index' in schema.properties.paths.properties);
});

test('paths.index must be a non-empty string', () => {
  for (const bad of [5, '', null]) {
    const l = R.loadConfig(mkProj({ paths: { index: bad } }));
    assert.equal(l.ok, false, JSON.stringify(bad));
    assert.ok(l.error.includes('paths.index'), l.error);
  }
  assert.equal(R.loadConfig(mkProj({ paths: { index: 'notes/idx.md' } })).ok, true);
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

test('config with a UTF-8 byte order mark loads', () => {
  const l = R.loadConfig(mkProj(null, '\uFEFF' + JSON.stringify({ router: { timeoutMs: 321 } })));
  assert.equal(l.ok, true, l.error);
  assert.equal(l.config.router.timeoutMs, 321);
});

test('router.endpoint must be https; plain http only for localhost', () => {
  for (const endpoint of ['http://example.com/v1', 'http://localhost.evil.test/x', 'http://127.0.0.1.evil.test/x', 'ftp://example.com/x', 'not a url']) {
    const l = R.loadConfig(mkProj({ router: { endpoint } }));
    assert.equal(l.ok, false, endpoint);
    assert.equal(l.error, 'sdd.config.json: router.endpoint: must be https (http only for localhost)', endpoint);
  }
  for (const endpoint of ['https://example.com/v1', 'http://127.0.0.1:8080/v1', 'http://localhost:9/x', 'http://[::1]:9/x']) {
    assert.equal(R.loadConfig(mkProj({ router: { endpoint } })).ok, true, endpoint);
  }
});

// ---------- risk flags ----------
const RP = R.defaultConfig().riskPaths;

test('globToRegExp: ** crosses directories, * and ? do not', () => {
  assert.ok(R.globToRegExp('**/a/**').test('a/b'));
  assert.ok(R.globToRegExp('**/a/**').test('x/y/a/b/c'));
  assert.ok(!R.globToRegExp('**/a/**').test('xa/b'));
  assert.ok(R.globToRegExp('x?y').test('xzy'));
  assert.ok(!R.globToRegExp('x?y').test('x/y'));
  assert.ok(R.globToRegExp('*.sql').test('a.sql'));
  assert.ok(!R.globToRegExp('*.sql').test('d/a.sql'));
  assert.ok(R.globToRegExp('**/*.sql').test('d/e/a.sql'));
  assert.ok(R.globToRegExp('a.b').test('a.b'));
  assert.ok(!R.globToRegExp('a.b').test('axb'));
});

test('riskFlags: default categories match their globs', () => {
  assert.deepEqual(R.riskFlags(['src/auth/token.ts'], RP), ['auth']);
  assert.deepEqual(R.riskFlags(['app/billing/charge.py'], RP), ['money']);
  assert.deepEqual(R.riskFlags(['db/migrations/001_init.sql'], RP), ['schema']);
  assert.deepEqual(R.riskFlags(['docs/openapi.yaml'], RP), ['contract']);
  assert.deepEqual(R.riskFlags(['src/users/profile.ts'], RP), ['pii']);
  assert.deepEqual(R.riskFlags(['README.md', 'src/util/strings.ts'], RP), []);
});

test('riskFlags: Windows separators, case, ./ prefix (Review Focus 1)', () => {
  assert.deepEqual(R.riskFlags(['src\\Auth\\Login.ts'], RP), ['auth']);
  assert.deepEqual(R.riskFlags(['.\\DB\\Migrations\\x.SQL'], RP), ['schema']);
  assert.deepEqual(R.riskFlags(['./src/billing/a.ts'], RP), ['money']);
});

test('riskFlags: several categories, config order, no duplicates', () => {
  assert.deepEqual(R.riskFlags(['src/auth/a.ts', 'src/auth/b.ts', 'src/billing/c.ts'], RP), ['auth', 'money']);
});

test('riskFlags: undefined or empty paths give no flags', () => {
  assert.deepEqual(R.riskFlags(undefined, RP), []);
  assert.deepEqual(R.riskFlags([], RP), []);
});

// ---------- TypeSafe wire adapter ----------
const rawOf = (o = {}) => ({
  kind: 'feature_logic',
  complexity: { levels: [0.1, 0.7, 0.2, 0], position: null, scaleMin: null, scaleMax: null, confidence: 0.7 },
  ambiguous: 0.1, irreversible: 0.1, cross_file: 0.1,
  usage: { input_tokens: 100, output_tokens: 20 },
  ...o,
});
const cx = (o) => ({ levels: null, position: null, scaleMin: null, scaleMax: null, confidence: null, ...o });

test('normalise: expected level and confidence from level probabilities', () => {
  const a = R.normalise(rawOf({ complexity: cx({ levels: [0, 1, 0, 0] }) }));
  assert.equal(a.complexityScore, 1);
  assert.equal(a.complexityConfidence, 1);
  const b = R.normalise(rawOf({ complexity: cx({ levels: [0.5, 0.5, 0, 0] }) }));
  assert.equal(b.complexityScore, 0.5);
  assert.equal(b.complexityConfidence, 0.5);
  const c = R.normalise(rawOf({ complexity: cx({ levels: [0, 0, 0.2, 0.8] }) }));
  assert.ok(Math.abs(c.complexityScore - 2.8) < 1e-9);
});

test('normalise: probabilities that do not sum to 1 are renormalised', () => {
  const a = R.normalise(rawOf({ complexity: cx({ levels: [0, 2, 0, 0] }) }));
  assert.equal(a.complexityScore, 1);
});

test('normalise: reported confidence wins over max probability', () => {
  const a = R.normalise(rawOf({ complexity: cx({ levels: [0, 1, 0, 0], confidence: 0.3 }) }));
  assert.equal(a.complexityConfidence, 0.3);
});

test('normalise: an already-weighted position is rescaled to [0,3]', () => {
  const a = R.normalise(rawOf({ complexity: cx({ position: 1.5, scaleMin: 0, scaleMax: 3, confidence: 0.8 }) }));
  assert.equal(a.complexityScore, 1.5);
  const b = R.normalise(rawOf({ complexity: cx({ position: 5, scaleMin: 0, scaleMax: 10, confidence: 0.8 }) }));
  assert.equal(b.complexityScore, 1.5);
});

test('normalise: garbage is a WireError, never another error type (Review Focus 4)', () => {
  const bad = [
    rawOf({ ambiguous: 1.7 }),
    rawOf({ irreversible: -0.2 }),
    rawOf({ cross_file: Number.NaN }),
    rawOf({ ambiguous: null }),
    rawOf({ complexity: cx({ levels: [0, 0, 0, 0] }) }),
    rawOf({ complexity: cx({ levels: [1, 0, 0] }) }),
    rawOf({ complexity: cx({ levels: [-1, 2, 0, 0] }) }),
    rawOf({ complexity: cx({}) }),
    rawOf({ complexity: cx({ position: 1, scaleMin: 0, scaleMax: 3 }) }), // no confidence available
    rawOf({ complexity: undefined }),
    null,
  ];
  for (const raw of bad) assert.throws(() => R.normalise(raw), R.WireError);
});

test('normalise: unusable usage becomes null, valid usage is kept', () => {
  assert.equal(R.normalise(rawOf({ usage: { input_tokens: 'x' } })).usage, null);
  assert.deepEqual(R.normalise(rawOf()).usage, { input_tokens: 100, output_tokens: 20 });
});

test('truncateChars cuts on code points', () => {
  assert.equal(R.truncateChars('x'.repeat(600), 500).length, 500);
  const e = R.truncateChars('😀'.repeat(10), 4);
  assert.equal(Array.from(e).length, 4);
  assert.equal(e.length, 8);
});

test('buildState sends metadata only', () => {
  const st = R.buildState({ stage: 'developer', summary: 'x'.repeat(600), paths: ['src/auth/a.ts'], files_touched: 3 }, ['auth'], 500);
  assert.deepEqual(Object.keys(st).sort(), ['files_touched', 'risk_flags', 'stage', 'summary']);
  assert.equal(st.summary.length, 500);
  assert.deepEqual(st.risk_flags, ['auth']);
  assert.equal(R.buildState({ stage: 'triage' }, [], 500).summary, '');
});

test('QUESTIONS covers the five spec questions', () => {
  assert.deepEqual(R.QUESTIONS.map((q) => q.id), ['kind', 'complexity', 'ambiguous', 'irreversible', 'cross_file']);
  assert.deepEqual(R.QUESTIONS.map((q) => q.primitive), ['choice', 'score', 'noul', 'noul', 'noul']);
});

test('buildRequest: endpoint, auth, model, all five questions, no paths', () => {
  const cfg = R.defaultConfig();
  const state = R.buildState({ stage: 'developer', summary: 'add helper', paths: ['src/auth/secret_name.ts'] }, ['auth'], 500);
  const { url, init } = R.buildRequest(cfg, 'k-123', state);
  assert.equal(url, cfg.router.endpoint);
  assert.equal(init.method, 'POST');
  assert.ok(JSON.stringify(init.headers).includes('k-123'));
  const body = JSON.parse(init.body);
  assert.equal(body.model, cfg.router.model);
  for (const id of ['kind', 'complexity', 'ambiguous', 'irreversible', 'cross_file']) assert.ok(init.body.includes(`"${id}"`), id);
  assert.ok(!init.body.includes('secret_name'));
  assert.deepEqual(body.state, state);
});

test('buildRequest: per-question structure matches the documented example', () => {
  // questionsOf is the one accessor to adapt if the live format nests questions differently.
  // Live format: `questions` is a map keyed by question id (assumptions §4).
  const questionsOf = (body) => Object.values(body.questions);
  const example = questionsOf(fixtureRequest());
  const built = questionsOf(JSON.parse(R.buildRequest(R.defaultConfig(), 'k', R.buildState({ stage: 'triage' }, [], 500)).init.body));
  assert.equal(built.length, example.length);
  const byPrimitive = (qs) => qs.map((q) => Object.keys(q).sort().join(','));
  assert.deepEqual(byPrimitive(built).sort(), byPrimitive(example).sort());
});

test('extractRaw reads the documented example response (golden)', () => {
  const raw = R.extractRaw(fixtureResponse());
  assert.equal(typeof raw.complexity, 'object');
  for (const k of ['ambiguous', 'irreversible', 'cross_file']) assert.equal(typeof raw[k], 'number');
  assert.deepEqual(raw, {
    kind: 'feature_logic',
    complexity: { levels: [0.05, 0.6, 0.3, 0.05], position: null, scaleMin: null, scaleMax: null, confidence: 0.55 },
    ambiguous: 0.22, irreversible: 0.04, cross_file: 0.71,
    usage: { input_tokens: 812, output_tokens: 64 },
  });
});

test('encodeResponse/extractRaw round trip', () => {
  const raw = rawOf({ complexity: cx({ levels: [0.05, 0.15, 0.6, 0.2], confidence: 0.6 }), ambiguous: 0.42, irreversible: 0.07, cross_file: 0.93 });
  assert.deepEqual(R.extractRaw(encodeResponse(raw)), raw);
});

test('parseResponse: non-objects and empty objects are WireErrors', () => {
  for (const j of [null, undefined, 'x', 42, [], {}]) assert.throws(() => R.parseResponse(j), R.WireError);
});

test('parseResponse: out-of-range probability in a live-format body is a WireError', () => {
  assert.throws(() => R.parseResponse(encodeResponse(rawOf({ ambiguous: 1.7 }))), R.WireError);
});

// ---------- mapping ----------
const CFG = R.defaultConfig();
const ans = (o = {}) => ({ kind: 'feature_logic', complexityScore: 0.5, complexityConfidence: 0.9, ambiguous: 0.1, irreversible: 0.1, cross_file: 0.1, usage: null, ...o });
const dec = (o, card = { stage: 'developer' }, flags = []) => R.decideFromAnswers(card, ans(o), CFG, flags);

test('mapping: base tier boundaries 0.99 / 1.0 / 1.99 / 2.0', () => {
  assert.equal(dec({ complexityScore: 0.99 }).tier, 'light');
  assert.equal(dec({ complexityScore: 1.0 }).tier, 'standard');
  assert.equal(dec({ complexityScore: 1.99 }).tier, 'standard');
  assert.equal(dec({ complexityScore: 2.0 }).tier, 'deep');
  assert.equal(dec({ complexityScore: 3 }).tier, 'deep');
});

test('mapping: each bump trigger adds one tier; thresholds are inclusive/exclusive as specified', () => {
  assert.equal(dec({ ambiguous: 0.5 }).tier, 'standard');
  assert.equal(dec({ ambiguous: 0.49 }).tier, 'light');
  assert.equal(dec({ irreversible: 0.5 }).tier, 'standard');
  assert.equal(dec({ complexityConfidence: 0.59 }).tier, 'standard');
  assert.equal(dec({ complexityConfidence: 0.6 }).tier, 'light');
});

test('mapping: bump is at most +1 in total and never past deep', () => {
  assert.equal(dec({ ambiguous: 0.9, irreversible: 0.9, complexityConfidence: 0.1 }).tier, 'standard');
  assert.equal(dec({ complexityScore: 2.5, ambiguous: 0.9 }).tier, 'deep');
  assert.equal(dec({ complexityScore: 1.5, ambiguous: 0.9 }).tier, 'deep');
});

test('mapping: cross_file lifts light to standard only', () => {
  assert.equal(dec({ cross_file: 0.5 }).tier, 'standard');
  assert.equal(dec({ complexityScore: 2.5, cross_file: 0.9 }).tier, 'deep');
});

test('mapping: stage floors raise but never lower', () => {
  assert.equal(dec({ complexityScore: 0.2 }, { stage: 'analyst' }).tier, 'standard');
  assert.equal(dec({ complexityScore: 0.2 }, { stage: 'reviewer-spec' }).tier, 'standard');
  assert.equal(dec({ complexityScore: 2.5 }, { stage: 'analyst' }).tier, 'deep');
});

test('mapping: risk minimums raise but never lower; lens is the deduplicated union', () => {
  const d = dec({ complexityScore: 0.2 }, { stage: 'developer' }, ['auth', 'money']);
  assert.equal(d.tier, 'standard');
  assert.deepEqual(d.lens, ['security']);
  assert.deepEqual(d.risk_flags, ['auth', 'money']);
  assert.equal(dec({ complexityScore: 2.5 }, { stage: 'developer' }, ['auth']).tier, 'deep');
  assert.deepEqual(dec({}, { stage: 'developer' }, ['schema', 'auth']).lens, ['data', 'security']);
});

test('mapping: effort and model come from the tier maps; confidence is reported', () => {
  const d = dec({ complexityScore: 2.5, complexityConfidence: 0.77 });
  assert.equal(d.effort, 'high');
  assert.equal(d.model, 'opus');
  assert.equal(d.confidence, 0.77);
  assert.equal(d.source, 'typesafe');
  assert.equal(d.human, false);
  assert.equal(d.lane, null);
});

test('mapping: custom models and efforts are honoured', () => {
  const cfg = { ...CFG, models: { light: 'a', standard: 'b', deep: 'c' }, efforts: { light: 'low', standard: 'high', deep: 'max' } };
  const d = R.decideFromAnswers({ stage: 'developer' }, ans({ complexityScore: 1.5 }), cfg, []);
  assert.equal(d.model, 'b');
  assert.equal(d.effort, 'high');
});

test('mapping: lane is set for triage only, with the specified rule order', () => {
  const t = (o, flags = []) => R.decideFromAnswers({ stage: 'triage' }, ans(o), CFG, flags);
  assert.equal(t({ complexityScore: 1.9 }).lane, 'QUICK');
  assert.equal(t({ complexityScore: 2.0 }).lane, 'FULL');
  assert.ok(t({ complexityScore: 2.3 }).reason.includes('lane FULL: complexity 2.3 ≥ 2.0'));
  assert.equal(t({ ambiguous: 0.5 }).lane, 'FULL');
  assert.equal(t({ irreversible: 0.5 }).lane, 'FULL');
  assert.equal(t({}, ['schema']).lane, 'FULL');
  assert.ok(t({}, ['schema']).reason.includes('lane FULL: risk flag schema'));
  assert.ok(t({}).reason.includes('lane QUICK'));
  assert.equal(R.decideFromAnswers({ stage: 'developer' }, ans({ complexityScore: 2.9 }), CFG, ['auth']).lane, null);
});

test('mapping: reason names every rule that moved the tier', () => {
  const d = dec({ complexityScore: 1.4, ambiguous: 0.71, complexityConfidence: 0.9 }, { stage: 'developer' }, ['auth']);
  assert.equal(d.tier, 'deep');
  assert.ok(d.reason.includes('complexity 1.4 → standard'));
  assert.ok(d.reason.includes('ambiguous 0.71'));
  assert.ok(d.reason.includes('+1 → deep'));
  const e = dec({ complexityScore: 0.2 }, { stage: 'analyst' });
  assert.ok(e.reason.includes('floor analyst=standard'));
  const f = dec({ complexityScore: 0.2 }, { stage: 'developer' }, ['auth']);
  assert.ok(f.reason.includes('risk auth → standard'));
  assert.ok(!f.reason.includes('\n'));
});

// ---------- escalation ----------
const esc = (o) => R.escalate({ stage: 'developer', ...o }, CFG, []);

test('escalation: retry at same tier below the threshold', () => {
  const d = esc({ last_tier: 'light', failures_at_last_tier: 1 });
  assert.equal(d.tier, 'light');
  assert.equal(d.source, 'escalation');
  assert.equal(d.human, false);
  assert.ok(d.reason.includes('retry at same tier'));
  assert.ok(!('confidence' in d));
});

test('escalation: next tier at the threshold, deep after standard, human after deep', () => {
  assert.equal(esc({ last_tier: 'light', failures_at_last_tier: 2 }).tier, 'standard');
  assert.equal(esc({ last_tier: 'standard', failures_at_last_tier: 2 }).tier, 'deep');
  const h = esc({ last_tier: 'deep', failures_at_last_tier: 2 });
  assert.equal(h.human, true);
  assert.equal(h.source, 'human');
  assert.equal(h.tier, 'deep');
  assert.equal(h.model, 'opus');
  const retryDeep = esc({ last_tier: 'deep', failures_at_last_tier: 1 });
  assert.equal(retryDeep.human, false);
  assert.equal(retryDeep.tier, 'deep');
});

test('escalation: threshold N comes from config', () => {
  const cfg = { ...CFG, limits: { ...CFG.limits, verifyFailuresPerTier: 3 } };
  assert.equal(R.escalate({ stage: 'developer', last_tier: 'light', failures_at_last_tier: 2 }, cfg, []).tier, 'light');
  assert.equal(R.escalate({ stage: 'developer', last_tier: 'light', failures_at_last_tier: 3 }, cfg, []).tier, 'standard');
});

test('escalation: missing and extreme counts (Review Focus 5)', () => {
  assert.equal(esc({ last_tier: 'standard' }).tier, 'standard');
  assert.ok(esc({ last_tier: 'standard' }).reason.includes('retry at same tier'));
  assert.equal(esc({ last_tier: 'light', failures_at_last_tier: 9999 }).tier, 'standard');
  assert.equal(esc({ last_tier: 'deep', failures_at_last_tier: 9999 }).human, true);
});

test('escalation: floors and risk minimums still apply to the escalated tier', () => {
  const d = R.escalate({ stage: 'developer', last_tier: 'light', failures_at_last_tier: 0 }, CFG, ['auth']);
  assert.equal(d.tier, 'standard');
  assert.deepEqual(d.lens, ['security']);
  assert.equal(R.escalate({ stage: 'analyst', last_tier: 'light', failures_at_last_tier: 0 }, CFG, []).tier, 'standard');
});

// ---------- fallback ----------
const fb = (card, flags = [], cause = 'no key') => R.fallbackDecision(card, CFG, flags, cause);

test('fallback: tiers come from fallbackTiers; reason is exactly the cause', () => {
  const d = fb({ stage: 'developer' });
  assert.equal(d.tier, 'standard');
  assert.equal(d.model, 'sonnet');
  assert.equal(d.source, 'fallback');
  assert.equal(d.reason, 'no key');
  assert.ok(!('confidence' in d));
  assert.equal(fb({ stage: 'planner' }).tier, 'deep');
  assert.equal(fb({ stage: 'triage' }).tier, 'light');
  assert.equal(fb({ stage: 'reviewer-code' }).tier, 'standard');
});

test('fallback: risk minimums raise the tier', () => {
  assert.equal(fb({ stage: 'triage', files_touched: 1 }, ['auth']).tier, 'standard');
});

test('fallback lane (triage): risk flag, keyword, size', () => {
  assert.equal(fb({ stage: 'triage', summary: 'rename a variable', files_touched: 1 }).lane, 'QUICK');
  assert.equal(fb({ stage: 'triage', summary: 'rename a variable', files_touched: 3 }).lane, 'FULL');
  assert.equal(fb({ stage: 'triage', summary: 'rename a variable' }).lane, 'FULL');
  assert.equal(fb({ stage: 'triage', summary: 'Drop table users', files_touched: 1 }).lane, 'FULL');
  assert.equal(fb({ stage: 'triage', summary: 'rotate the SECRET', files_touched: 1 }).lane, 'FULL');
  assert.equal(fb({ stage: 'triage', summary: 'fix typo', files_touched: 1 }, ['pii']).lane, 'FULL');
  assert.equal(fb({ stage: 'developer', summary: 'drop everything', files_touched: 9 }).lane, null);
});

test('FALLBACK_CAUSES lists the documented reasons', () => {
  assert.ok(R.FALLBACK_CAUSES.includes('no key'));
  assert.ok(R.FALLBACK_CAUSES.includes('bad response'));
});

// ---------- card and log ----------
test('parseCard: minimal and full valid cards', () => {
  assert.deepEqual(R.parseCard('{"stage":"triage"}'), { card: { stage: 'triage' }, warnings: [] });
  const full = { stage: 'developer', summary: 's', paths: ['a/b'], files_touched: 2, tasks_upstream: 0, tasks_downstream: 3, last_tier: 'light', failures_at_last_tier: 1 };
  assert.deepEqual(R.parseCard(JSON.stringify(full)).card, full);
});

test('parseCard: caller bugs throw CardError', () => {
  for (const t of ['not json', '[]', '"x"', 'null', '{}', '{"stage":"bogus"}', '{"stage":3}']) {
    assert.throws(() => R.parseCard(t), R.CardError, t);
  }
});

test('parseCard: invalid optional fields are ignored with a warning', () => {
  const t = JSON.stringify({ stage: 'developer', summary: 5, paths: 'x', files_touched: -1, tasks_upstream: 1.5, tasks_downstream: 'n', last_tier: 'mega', failures_at_last_tier: -2 });
  const { card, warnings } = R.parseCard(t);
  assert.deepEqual(card, { stage: 'developer' });
  for (const f of ['summary', 'paths', 'files_touched', 'tasks_upstream', 'tasks_downstream', 'last_tier', 'failures_at_last_tier']) {
    assert.ok(warnings.some((w) => w.startsWith(`card.${f}:`)), f);
  }
  assert.deepEqual(R.parseCard('{"stage":"developer","paths":["a",1]}').card, { stage: 'developer' });
});

test('appendLog appends JSON lines and creates directories', () => {
  const d = mkProj();
  const p = join(d, 'nested', 'dir', 'log.jsonl');
  assert.equal(R.appendLog(p, { a: 1 }), true);
  assert.equal(R.appendLog(p, { b: 2 }), true);
  assert.deepEqual(readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)), [{ a: 1 }, { b: 2 }]);
});

test('appendLog returns false instead of throwing when the path is unusable', () => {
  const d = mkProj();
  writeFileSync(join(d, 'blocker'), 'x');
  assert.equal(R.appendLog(join(d, 'blocker', 'log.jsonl'), { a: 1 }), false);
});

test('logEntry keeps sent fields only and never paths', () => {
  const e = R.logEntry({ stage: 'developer', summary: 's', paths: ['src/auth/a.ts'], files_touched: 1 }, { tier: 'light' }, { input_tokens: 1, output_tokens: 2 }, { kind: 'k' }, new Date('2026-10-08T00:00:00Z'));
  assert.deepEqual(e, { ts: '2026-10-08T00:00:00.000Z', card: { stage: 'developer', summary: 's', files_touched: 1 }, decision: { tier: 'light' }, usage: { input_tokens: 1, output_tokens: 2 }, answers: { kind: 'k' } });
  assert.equal(R.logEntry({ stage: 'triage' }, {}, undefined, undefined).usage, null);
  assert.equal(R.logEntry({ stage: 'triage' }, {}, undefined, undefined).answers, null);
});

// ---------- route CLI (integration) ----------
const ROUTE = fileURLToPath(new URL('../bin/route.mjs', import.meta.url));
const KEY_ENV = R.defaultConfig().router.apiKeyEnv;
const KEY = 'sk-test-SECRET-1234';

function runRoute({ stdin, args = [], cwd, env = {} }) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [ROUTE, ...args], { cwd, env: { ...process.env, [KEY_ENV]: '', ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.stdin.end(stdin ?? '');
  });
}
const cardText = (o = {}) => JSON.stringify({ stage: 'developer', summary: 'add a greeting helper', files_touched: 1, ...o });
const lines = (s) => s.split('\n').filter(Boolean);
const withMock = async (handler, cfg, fn) => {
  const mock = await startMock(handler);
  try {
    const dir = mkProj({ router: { endpoint: mock.url, timeoutMs: 300, ...(cfg?.router ?? {}) }, ...Object.fromEntries(Object.entries(cfg ?? {}).filter(([k]) => k !== 'router')) });
    return await fn({ mock, dir });
  } finally { await mock.close(); }
};
const ok200 = (raw) => (rec, res) => json(res, 200, encodeResponse(raw));

test('route: no key → fallback "no key"; stdout is exactly one JSON line; exit 0', async () => {
  const r = await runRoute({ stdin: cardText(), cwd: mkProj() });
  assert.equal(r.code, 0);
  assert.equal(lines(r.stdout).length, 1);
  assert.ok(r.stdout.endsWith('\n'));
  const d = JSON.parse(r.stdout);
  assert.equal(d.source, 'fallback');
  assert.equal(d.reason, 'no key');
  assert.equal(d.tier, 'standard');
  assert.equal(d.model, 'sonnet');
  assert.equal(r.stderr, ''); // the shipped endpoint and key variable raise no warning
});

test('route: a non-default endpoint or key variable is warned about; the key value never appears', async () => {
  const OTHER = 'SDD_TEST_OTHER_KEY';
  await withMock(ok200(rawOf()), { router: { apiKeyEnv: OTHER } }, async ({ mock, dir }) => {
    const r = await runRoute({ stdin: cardText(), cwd: dir, env: { [OTHER]: KEY } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, 'typesafe');
    assert.ok(r.stderr.includes(`sdd route: warning: sdd.config.json: router.endpoint is not the default (${mock.url})`), r.stderr);
    assert.ok(r.stderr.includes(`sdd route: warning: sdd.config.json: router.apiKeyEnv is not the default (${OTHER}); that variable's value is sent as the bearer token`), r.stderr);
    const check = await runRoute({ args: ['--check-config'], cwd: dir, env: { [OTHER]: KEY } });
    assert.equal(check.code, 0);
    assert.ok(check.stderr.includes('router.endpoint is not the default'), check.stderr);
    assert.ok(check.stderr.includes('router.apiKeyEnv is not the default'), check.stderr);
    for (const text of [r.stdout, r.stderr, check.stdout, check.stderr]) assert.ok(!text.includes(KEY));
  });
  const out = await R.route({ stage: 'developer' }, { projectDir: mkProj({ router: { enabled: false, apiKeyEnv: 'X_KEY' } }), env: { X_KEY: KEY } });
  assert.deepEqual(out.warnings, ["sdd.config.json: router.apiKeyEnv is not the default (X_KEY); that variable's value is sent as the bearer token"]);
});

test('route: router disabled → "disabled" even with a key', async () => {
  const r = await runRoute({ stdin: cardText(), cwd: mkProj({ router: { enabled: false } }), env: { [KEY_ENV]: KEY } });
  assert.equal(JSON.parse(r.stdout).reason, 'disabled');
});

test('route: invalid config → one-line stderr naming the field; decision reason "invalid config"', async () => {
  const r = await runRoute({ stdin: cardText(), cwd: mkProj({ router: { noulThreshold: 7 } }), env: { [KEY_ENV]: KEY } });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).reason, 'invalid config');
  assert.equal(lines(r.stderr).length, 1);
  assert.ok(r.stderr.includes('router.noulThreshold'));
});

test('route: caller bugs exit 2 with nothing on stdout', async () => {
  for (const stdin of ['not json', '{}', '{"stage":"bogus"}', '[]', '']) {
    const r = await runRoute({ stdin, cwd: mkProj() });
    assert.equal(r.code, 2, stdin);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.length > 0);
  }
});

test('route: invalid optional card fields are ignored with a stderr warning', async () => {
  const r = await runRoute({ stdin: cardText({ paths: 'x', files_touched: -1, last_tier: 'mega' }), cwd: mkProj() });
  assert.equal(r.code, 0);
  for (const f of ['card.paths', 'card.files_touched', 'card.last_tier']) assert.ok(r.stderr.includes(f), f);
  assert.equal(JSON.parse(r.stdout).source, 'fallback');
});

test('route: --card reads a file', async () => {
  const dir = mkProj();
  writeFileSync(join(dir, 'card.json'), cardText());
  const r = await runRoute({ args: ['--card', join(dir, 'card.json')], cwd: dir });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).stage, 'developer');
});

test('route: Windows-style paths flag risk locally (Review Focus 1)', async () => {
  const r = await runRoute({ stdin: cardText({ stage: 'triage', paths: ['src\\auth\\Login.ts'] }), cwd: mkProj() });
  const d = JSON.parse(r.stdout);
  assert.deepEqual(d.risk_flags, ['auth']);
  assert.equal(d.lane, 'FULL');
  assert.equal(d.tier, 'standard');
  assert.deepEqual(d.lens, ['security']);
});

test('route: TypeSafe success — one request, metadata only, key never leaked, log written', async () => {
  const raw = rawOf({ complexity: cx({ levels: [0, 0.2, 0.8, 0], confidence: 0.9 }), ambiguous: 0.7 });
  await withMock(ok200(raw), { router: { maxSummaryChars: 20 } }, async ({ mock, dir }) => {
    const stdin = cardText({ summary: 'y'.repeat(100), paths: ['src/auth/Login.ts'], files_touched: 2, tasks_downstream: 3 });
    const r = await runRoute({ stdin, cwd: dir, env: { [KEY_ENV]: KEY } });
    assert.equal(r.code, 0, r.stderr);
    const d = JSON.parse(r.stdout);
    assert.equal(d.source, 'typesafe');
    assert.equal(d.tier, 'deep');
    assert.equal(d.confidence, 0.9);
    assert.ok(d.reason.includes('ambiguous'));
    assert.deepEqual(d.risk_flags, ['auth']);

    assert.equal(mock.requests.length, 1);
    const body = JSON.parse(mock.requests[0].body);
    assert.equal(body.state.summary, 'y'.repeat(20));
    assert.deepEqual(body.state.risk_flags, ['auth']);
    assert.equal(body.state.files_touched, 2);
    assert.ok(!mock.requests[0].body.includes('src/auth'));
    assert.ok(!mock.requests[0].body.includes('Login.ts'));

    const log = readFileSync(join(dir, '.sdd', 'decisions.jsonl'), 'utf8');
    const entry = JSON.parse(log.trim());
    assert.equal(entry.decision.source, 'typesafe');
    assert.deepEqual(entry.usage, { input_tokens: 100, output_tokens: 20 });
    assert.deepEqual(Object.keys(entry.answers).sort(), ['ambiguous', 'complexity', 'cross_file', 'irreversible', 'kind']);
    assert.ok(!('paths' in entry.card));
    for (const text of [r.stdout, r.stderr, log]) assert.ok(!text.includes(KEY));
  });
});

test('route: emoji summary longer than the limit is cut on a code point; output stays valid JSON (Review Focus 2)', async () => {
  await withMock(ok200(rawOf()), { router: { maxSummaryChars: 10 } }, async ({ mock, dir }) => {
    const r = await runRoute({ stdin: cardText({ summary: '😀 "quoted" \\ ' + '😀'.repeat(50) }), cwd: dir, env: { [KEY_ENV]: KEY } });
    assert.equal(r.code, 0);
    assert.doesNotThrow(() => JSON.parse(r.stdout));
    assert.equal(Array.from(JSON.parse(mock.requests[0].body).state.summary).length, 10);
    const entry = JSON.parse(readFileSync(join(dir, '.sdd', 'decisions.jsonl'), 'utf8').trim());
    assert.equal(Array.from(entry.card.summary).length, 10);
  });
});

test('route: an escalation card wins over an invalid config (defaults are used; deviation 4)', async () => {
  const r = await runRoute({ stdin: cardText({ last_tier: 'light', failures_at_last_tier: 2 }), cwd: mkProj({ router: { noulThreshold: 7 } }), env: { [KEY_ENV]: KEY } });
  assert.equal(r.code, 0);
  const d = JSON.parse(r.stdout);
  assert.equal(d.source, 'escalation');
  assert.equal(d.tier, 'standard');
  assert.ok(r.stderr.includes('router.noulThreshold'));
});

test('route: escalation cards never call TypeSafe', async () => {
  await withMock((rec, res) => json(res, 200, {}), {}, async ({ mock, dir }) => {
    const run = (n, last) => runRoute({ stdin: cardText({ last_tier: last, failures_at_last_tier: n }), cwd: dir, env: { [KEY_ENV]: KEY } });
    assert.equal(JSON.parse((await run(1, 'light')).stdout).tier, 'light');
    assert.equal(JSON.parse((await run(2, 'light')).stdout).tier, 'standard');
    const h = JSON.parse((await run(2, 'deep')).stdout);
    assert.equal(h.human, true);
    assert.equal(h.source, 'human');
    assert.equal(mock.requests.length, 0);
  });
});

for (const [status, requests, reason] of [[401, 1, 'http 401'], [422, 1, 'http 422'], [500, 1, 'http 500'], [429, 2, 'http 429'], [529, 2, 'http 529']]) {
  test(`route: HTTP ${status} → fallback "${reason}" after ${requests} request(s)`, async () => {
    await withMock((rec, res) => json(res, status, { error: 'x' }), {}, async ({ mock, dir }) => {
      const r = await runRoute({ stdin: cardText(), cwd: dir, env: { [KEY_ENV]: KEY } });
      assert.equal(r.code, 0);
      const d = JSON.parse(r.stdout);
      assert.equal(d.source, 'fallback');
      assert.equal(d.reason, reason);
      assert.equal(mock.requests.length, requests);
    });
  });
}

test('route: 429 then success retries once and returns the TypeSafe decision', async () => {
  await withMock((rec, res, n) => (n === 1 ? json(res, 429, {}) : json(res, 200, encodeResponse(rawOf()))), {}, async ({ mock, dir }) => {
    const r = await runRoute({ stdin: cardText(), cwd: dir, env: { [KEY_ENV]: KEY } });
    assert.equal(JSON.parse(r.stdout).source, 'typesafe');
    assert.equal(mock.requests.length, 2);
  });
});

test('route: timeout → "timeout"; one retry; wall time bounded by 2×timeoutMs+500ms', async () => {
  await withMock(() => { /* never answers */ }, { router: { timeoutMs: 200 } }, async ({ mock, dir }) => {
    const t0 = Date.now();
    const r = await runRoute({ stdin: cardText(), cwd: dir, env: { [KEY_ENV]: KEY } });
    const elapsed = Date.now() - t0;
    assert.equal(JSON.parse(r.stdout).reason, 'timeout');
    assert.equal(mock.requests.length, 2);
    assert.ok(elapsed >= 600, `retry delay observed (${elapsed}ms)`);
    assert.ok(elapsed < 2 * 200 + 500 + 1500, `bounded (${elapsed}ms)`); // 1500ms slack covers process start-up
  });
});

test('route: connection refused → "network error"', async () => {
  const dir = mkProj({ router: { endpoint: 'http://127.0.0.1:1/v1/systemone', timeoutMs: 300 } });
  const r = await runRoute({ stdin: cardText(), cwd: dir, env: { [KEY_ENV]: KEY } });
  assert.equal(JSON.parse(r.stdout).reason, 'network error');
});

test('route: malformed responses → "bad response", no retry, exit 0 (Review Focus 4)', async () => {
  const handlers = [
    (rec, res) => { res.writeHead(200); res.end('not json'); },
    (rec, res) => json(res, 200, {}),
    (rec, res) => json(res, 200, encodeResponse(rawOf({ ambiguous: 1.7 }))),
    (rec, res) => json(res, 200, encodeResponse(rawOf({ complexity: cx({ levels: [0, 0, 0, 0], confidence: 0.5 }) }))),
  ];
  for (const h of handlers) {
    await withMock(h, {}, async ({ mock, dir }) => {
      const r = await runRoute({ stdin: cardText(), cwd: dir, env: { [KEY_ENV]: KEY } });
      assert.equal(r.code, 0);
      assert.equal(JSON.parse(r.stdout).reason, 'bad response');
      assert.equal(mock.requests.length, 1);
    });
  }
});

test('route: every call appends one log line; a log failure changes nothing else', async () => {
  const dir = mkProj();
  await runRoute({ stdin: cardText(), cwd: dir });
  await runRoute({ stdin: cardText(), cwd: dir });
  assert.equal(lines(readFileSync(join(dir, '.sdd', 'decisions.jsonl'), 'utf8')).length, 2);

  const bad = mkProj({ paths: { log: 'blocker/log.jsonl' } });
  writeFileSync(join(bad, 'blocker'), 'x');
  const r = await runRoute({ stdin: cardText(), cwd: bad });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).reason, 'no key');
  assert.ok(r.stderr.includes('decision log'));
});

test('route --check-config: ok or a one-line error', async () => {
  const good = await runRoute({ args: ['--check-config'], cwd: mkProj() });
  assert.equal(good.code, 0);
  assert.equal(good.stdout.trim(), 'ok');
  const bad = await runRoute({ args: ['--check-config'], cwd: mkProj({ limits: { reviewRounds: 0 } }) });
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, '');
  assert.ok(bad.stderr.includes('limits.reviewRounds'));
});
