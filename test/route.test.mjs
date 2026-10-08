import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../bin/route.mjs';
import { encodeResponse, fixtureRequest, fixtureResponse } from './helpers/typesafe-mock.mjs';

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
