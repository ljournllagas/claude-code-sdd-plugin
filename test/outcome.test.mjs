import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../bin/outcome.mjs';

const OUTCOME = fileURLToPath(new URL('../bin/outcome.mjs', import.meta.url));
const KEYS = ['ts', 'kind', 'stage', 'slug', 'task', 'first_attempt', 'tier', 'source', 'reason', 'result', 'duration_ms', 'agent_tokens'];

const tmp = () => mkdtempSync(join(tmpdir(), 'sdd outcome '));
const run = (cwd, args) => spawnSync(process.execPath, [OUTCOME, ...args], { cwd, encoding: 'utf8' });
const BASE = ['--slug', '20261013-demo', '--task', 'T3', '--first-attempt', 'true', '--tier', 'standard', '--source', 'typesafe',
  '--reason', 'complexity 1.4 → standard; ambiguous 0.71 → +1 → deep', '--result', 'pass'];
const without = (flag) => { const i = BASE.indexOf(flag); return [...BASE.slice(0, i), ...BASE.slice(i + 2)]; };
const logLines = (d) => readFileSync(join(d, '.sdd', 'decisions.jsonl'), 'utf8').split('\n').filter(Boolean);

// ---------- the line (AC-1, AC-2, AC-3, AC-4, AC-8) ----------
test('a valid call appends one line with exactly the AC-1 keys, prints nothing and exits 0', () => {
  const d = tmp();
  const before = Date.now();
  const r = run(d, [...BASE, '--duration-ms', '1500', '--agent-tokens', '48210']);
  const after = Date.now();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  const lines = logLines(d);
  assert.equal(lines.length, 1);
  const o = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(o), KEYS);
  assert.equal(o.kind, 'outcome');
  assert.equal(o.stage, 'developer');
  assert.equal(o.slug, '20261013-demo');
  assert.equal(o.task, 'T3');
  assert.equal(o.first_attempt, true);
  assert.equal(o.tier, 'standard');
  assert.equal(o.source, 'typesafe');
  assert.equal(o.reason, 'complexity 1.4 → standard; ambiguous 0.71 → +1 → deep');
  assert.equal(o.result, 'pass');
  assert.equal(o.duration_ms, 1500);
  assert.equal(o.agent_tokens, 48210);
  const t = Date.parse(o.ts);
  assert.ok(t >= before - 1000 && t <= after + 1000, o.ts);
  assert.match(o.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  assert.deepEqual(O.validateOutcome(o), []);
});

test('an outcome line is appended after existing lines, which stay byte-identical', () => {
  const d = tmp();
  mkdirSync(join(d, '.sdd'));
  const existing = '{"ts":"t","card":{"stage":"developer"},"decision":{"tier":"light","source":"typesafe"},"usage":null,"answers":null}\n';
  writeFileSync(join(d, '.sdd', 'decisions.jsonl'), existing);
  assert.equal(run(d, BASE).status, 0);
  const text = readFileSync(join(d, '.sdd', 'decisions.jsonl'), 'utf8');
  assert.ok(text.startsWith(existing));
  assert.equal(text.slice(existing.length).split('\n').filter(Boolean).length, 1);
});

test('omitted duration and tokens are stored as null; an empty reason is accepted', () => {
  const d = tmp();
  const args = BASE.map((v, i) => (BASE[i - 1] === '--reason' ? '' : v));
  const r = run(d, args);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(logLines(d)[0]);
  assert.equal(o.duration_ms, null);
  assert.equal(o.agent_tokens, null);
  assert.equal(o.reason, '');
});

test('--first-attempt false and every result and source value are accepted', () => {
  const d = tmp();
  for (const result of ['pass', 'fail', 'blocked']) {
    for (const source of ['typesafe', 'fallback', 'escalation']) {
      const a = BASE.map((v, i) => (BASE[i - 1] === '--result' ? result : BASE[i - 1] === '--source' ? source : BASE[i - 1] === '--first-attempt' ? 'false' : v));
      assert.equal(run(d, a).status, 0, `${result}/${source}`);
    }
  }
  assert.equal(logLines(d).length, 9);
  assert.ok(logLines(d).every((l) => JSON.parse(l).first_attempt === false));
});

test('the log path comes from the configuration', () => {
  const d = tmp();
  writeFileSync(join(d, 'sdd.config.json'), JSON.stringify({ paths: { log: 'run/log.jsonl' } }));
  assert.equal(run(d, BASE).status, 0);
  assert.equal(JSON.parse(readFileSync(join(d, 'run', 'log.jsonl'), 'utf8').trim()).kind, 'outcome');
  assert.equal(existsSync(join(d, '.sdd', 'decisions.jsonl')), false);
});

// ---------- flag validation (AC-5, AC-8) ----------
test('each required flag missing exits 2, names the flag and appends nothing', () => {
  for (const flag of ['--slug', '--task', '--first-attempt', '--tier', '--source', '--reason', '--result']) {
    const d = tmp();
    const r = run(d, without(flag));
    assert.equal(r.status, 2, flag);
    assert.ok(r.stderr.includes(flag), `${flag}: ${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(join(d, '.sdd', 'decisions.jsonl')), false, flag);
  }
});

test('unknown flags (including --ts) and out-of-domain values exit 2 and append nothing', () => {
  const cases = [
    [[...BASE, '--ts', '2026-10-13T00:00:00Z'], '--ts'],
    [[...BASE, '--bogus', 'x'], '--bogus'],
    [BASE.map((v, i) => (BASE[i - 1] === '--result' ? 'maybe' : v)), '--result'],
    [BASE.map((v, i) => (BASE[i - 1] === '--tier' ? 'ultra' : v)), '--tier'],
    [BASE.map((v, i) => (BASE[i - 1] === '--source' ? 'human' : v)), '--source'],
    [BASE.map((v, i) => (BASE[i - 1] === '--first-attempt' ? 'maybe' : v)), '--first-attempt'],
    [BASE.map((v, i) => (BASE[i - 1] === '--slug' ? '' : v)), '--slug'],
    [BASE.map((v, i) => (BASE[i - 1] === '--task' ? '' : v)), '--task'],
    [[...BASE, '--duration-ms', '-5'], '--duration-ms'],
    [[...BASE, '--duration-ms', '1.5'], '--duration-ms'],
    [[...BASE, '--agent-tokens', 'lots'], '--agent-tokens'],
    [[...BASE, '--agent-tokens'], '--agent-tokens'],
  ];
  for (const [args, flag] of cases) {
    const d = tmp();
    const r = run(d, args);
    assert.equal(r.status, 2, `${flag}: ${r.stderr}`);
    assert.ok(r.stderr.includes(flag), `${flag}: ${r.stderr}`);
    assert.equal(existsSync(join(d, '.sdd', 'decisions.jsonl')), false, flag);
  }
});

// ---------- failure behaviour (AC-6, AC-7) ----------
test('an unwritable log exits 0 with a stderr warning', () => {
  const d = tmp();
  writeFileSync(join(d, '.sdd'), 'a file where the directory should be');
  const r = run(d, BASE);
  assert.equal(r.status, 0);
  assert.notEqual(r.stderr.trim(), '');
});

test('an invalid sdd.config.json still appends to the default path, warns, and exits 0', () => {
  const d = tmp();
  writeFileSync(join(d, 'sdd.config.json'), '{ not json');
  const r = run(d, BASE);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes('sdd.config.json'), r.stderr);
  assert.equal(logLines(d).length, 1);
});

// ---------- validateOutcome (AC-17) ----------
const GOOD = () => ({
  ts: '2026-10-13T08:00:00.000Z', kind: 'outcome', stage: 'developer', slug: 's', task: 'T1', first_attempt: true, tier: 'light',
  source: 'fallback', reason: '', result: 'fail', duration_ms: null, agent_tokens: 0,
});

test('validateOutcome accepts a good line and reports each kind of defect', () => {
  assert.deepEqual(O.validateOutcome(GOOD()), []);
  const bad = (patch) => O.validateOutcome({ ...GOOD(), ...patch });
  assert.ok(bad({ kind: 'decision' }).length > 0);
  assert.ok(bad({ stage: 'analyst' }).length > 0);
  assert.ok(bad({ slug: '' }).length > 0);
  assert.ok(bad({ first_attempt: 'true' }).length > 0);
  assert.ok(bad({ tier: 'ultra' }).length > 0);
  assert.ok(bad({ source: 'human' }).length > 0);
  assert.ok(bad({ result: 'maybe' }).length > 0);
  assert.ok(bad({ reason: null }).length > 0);
  assert.ok(bad({ duration_ms: -1 }).length > 0);
  assert.ok(bad({ duration_ms: 1.5 }).length > 0);
  assert.ok(bad({ agent_tokens: '5' }).length > 0);
  assert.ok(bad({ ts: 'yesterday' }).length > 0);
  assert.ok(bad({ extra: 1 }).length > 0);
  const missing = GOOD();
  delete missing.task;
  assert.ok(O.validateOutcome(missing).length > 0);
  for (const v of [null, [], 'x', 7]) assert.ok(O.validateOutcome(v).length > 0);
});

// ---------- v0.6: values read from the marker ----------
test('--from-marker fills slug, tier, source, reason and first_attempt from the marker entry', () => {
  const d = tmp();
  mkdirSync(join(d, '.sdd'));
  const routed = { source: 'escalation', reason: 'retry at same tier (1/2 failures at standard)' };
  const marker = { slug: '20261015-demo', lane: 'FULL', stage: 'executing', updated: new Date().toISOString(), tasks: {
    T1: { attempt_tier: 'standard', in_progress: false, routed: { source: 'fallback', reason: 'no key' } },
    T2: { attempt_tier: 'standard', last_tier: 'standard', failures_at_last_tier: 1, in_progress: false, routed },
    T3: { attempt_tier: 'light', in_progress: false },
  } };
  writeFileSync(join(d, '.sdd', 'active.json'), JSON.stringify(marker));
  assert.equal(run(d, ['--from-marker', '--task', 'T1', '--result', 'fail']).status, 0);
  assert.equal(run(d, ['--task', 'T2', '--from-marker', '--result', 'pass', '--duration-ms', '900']).status, 0);
  const [a, b] = logLines(d).map((l) => JSON.parse(l));
  assert.deepEqual([a.slug, a.task, a.tier, a.source, a.reason, a.first_attempt, a.result], ['20261015-demo', 'T1', 'standard', 'fallback', 'no key', true, 'fail']);
  assert.deepEqual([b.first_attempt, b.source, b.reason, b.duration_ms], [false, 'escalation', routed.reason, 900]);
  const none = run(d, ['--from-marker', '--task', 'T3', '--result', 'pass']);
  assert.equal(none.status, 0);
  assert.match(none.stderr, /no routed decision; no line written/);
  assert.equal(logLines(d).length, 2);
  assert.equal(run(d, ['--from-marker', '--result', 'pass']).status, 2);
});
