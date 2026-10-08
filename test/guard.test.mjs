import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, DEFAULTS, SUBAGENT_FIELD } from '../hooks/guard.mjs';

const GUARD = fileURLToPath(new URL('../hooks/guard.mjs', import.meta.url));
const NOW = Date.parse('2026-10-08T12:00:00Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();

// Project directories contain a space (Review Focus 1).
function proj({ ago = 1, config, markerRaw, noMarker, markerPath = '.sdd/active.json' } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'sdd guard '));
  if (!noMarker) {
    const p = join(d, ...markerPath.split('/'));
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, markerRaw ?? JSON.stringify({ slug: 's', lane: 'FULL', stage: 'executing', updated: iso(ago) }));
  }
  if (config) writeFileSync(join(d, 'sdd.config.json'), JSON.stringify(config));
  return d;
}
const call = (cwd, target, extra = {}) => ({ tool_name: 'Write', tool_input: { file_path: target }, cwd, ...extra });
const ev = (input) => evaluate(input, NOW);

test('main session: edit outside the allowed set is denied with the exact message', () => {
  const d = proj();
  const r = ev(call(d, join(d, 'src', 'app.js')));
  assert.equal(r.deny, true);
  assert.equal(r.message, 'SDD guard: the team-lead session may not edit src/app.js. Delegate to the developer agent, or run "/sdd end" if no SDD run is active (marker .sdd/active.json expires after 12h of inactivity).');
});

test('main session: run artifacts are allowed', () => {
  const d = proj();
  for (const t of [
    join(d, '.sdd', 'review', 'x.md'), join(d, '.sdd', 'active.json'), join(d, 'CONTEXT.md'), join(d, 'sdd.config.json'),
    join(d, 'docs', 'sdd', 'specs', 'a.md'), join(d, 'docs', 'sdd', 'plans', 'p.md'), 'CONTEXT.md', '.sdd/decisions.jsonl',
  ]) assert.equal(ev(call(d, t)).deny, false, t);
});

test('main session: look-alike paths are denied', () => {
  const d = proj();
  for (const t of ['.sdd-other/x', 'docs/sdd/specs-old/a.md', 'docs/sdd/specsx.md', 'CONTEXT.md.bak', 'src/CONTEXT.md']) {
    assert.equal(ev(call(d, join(d, t))).deny, true, t);
  }
});

test('a path outside the project is denied and named in the message', () => {
  const d = proj();
  const outside = join(tmpdir(), 'elsewhere.txt');
  const r = ev(call(d, outside));
  assert.equal(r.deny, true);
  assert.ok(r.message.includes('elsewhere.txt'));
});

test('NotebookEdit is guarded through notebook_path', () => {
  const d = proj();
  assert.equal(ev({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(d, 'a.ipynb') }, cwd: d }).deny, true);
});

test('subagent calls are never blocked', () => {
  const d = proj();
  assert.equal(ev(call(d, join(d, 'src', 'app.js'), { [SUBAGENT_FIELD]: 'agent-1' })).deny, false);
});

test('stale marker allows; fresh marker denies; ttl comes from config', () => {
  assert.equal(ev(call(proj({ ago: 13 }), 'src/a.js')).deny, false);
  assert.equal(ev(call(proj({ ago: 11.9 }), 'src/a.js')).deny, true);
  const cfg = { guard: { ttlHours: 2 } };
  assert.equal(ev(call(proj({ ago: 3, config: cfg }), 'src/a.js')).deny, false);
  const fresh = ev(call(proj({ ago: 1, config: cfg }), 'src/a.js'));
  assert.equal(fresh.deny, true);
  assert.ok(fresh.message.includes('after 2h of inactivity'));
});

test('fail open: missing, empty, truncated or malformed marker (Review Focus 3)', () => {
  assert.equal(ev(call(proj({ noMarker: true }), 'src/a.js')).deny, false);
  for (const raw of ['', '{', 'not json', '{"slug":"x"}', '{"updated":"garbage"}', '[]', 'null']) {
    assert.equal(ev(call(proj({ markerRaw: raw }), 'src/a.js')).deny, false, JSON.stringify(raw));
  }
});

test('fail open: other tools, unknown shapes, unreadable config', () => {
  const d = proj();
  assert.equal(ev({ tool_name: 'Bash', tool_input: { command: 'rm x' }, cwd: d }).deny, false);
  for (const v of [null, undefined, 'x', 42, [], {}, { tool_name: 'Write' }, { tool_name: 'Write', tool_input: {}, cwd: d }, { tool_name: 'Write', tool_input: { file_path: 5 }, cwd: d }]) {
    assert.equal(ev(v).deny, false, JSON.stringify(v));
  }
  const bad = proj();
  writeFileSync(join(bad, 'sdd.config.json'), '{ nope');
  assert.equal(ev(call(bad, join(bad, 'src', 'a.js'))).deny, true); // unreadable config → defaults, still guarded
});

test('configured specs/plans directories and marker path are honoured', () => {
  const d = proj({ config: { paths: { specs: 'specs', active: '.sdd/run.json' } }, markerPath: '.sdd/run.json' });
  assert.equal(ev(call(d, join(d, 'specs', 'a.md'))).deny, false);
  assert.equal(ev(call(d, join(d, 'docs', 'sdd', 'plans', 'p.md'))).deny, false);
  assert.equal(ev(call(d, join(d, 'docs', 'sdd', 'specs', 'a.md'))).deny, true);
});

test('Windows-style backslash target is matched (Review Focus 1)', { skip: process.platform !== 'win32' }, () => {
  const d = proj();
  assert.equal(ev(call(d, 'docs\\sdd\\specs\\a.md')).deny, false);
  assert.equal(ev(call(d, 'src\\app.js')).deny, true);
});

test('Windows-style absolute backslash target and cwd are matched', { skip: process.platform !== 'win32' }, () => {
  const d = proj();
  const win = (p) => p.replace(/\//g, '\\');
  assert.equal(ev(call(win(d), win(join(d, 'docs', 'sdd', 'specs', 'a.md')))).deny, false);
  const r = ev(call(win(d), win(join(d, 'src', 'app.js'))));
  assert.equal(r.deny, true);
  assert.ok(r.message.includes('may not edit src/app.js.'));
});

test('guard defaults equal the shipped default config', () => {
  const cfg = JSON.parse(readFileSync(new URL('../config/sdd.config.default.json', import.meta.url), 'utf8'));
  assert.deepEqual(DEFAULTS, { specs: cfg.paths.specs, plans: cfg.paths.plans, active: cfg.paths.active, ttlHours: cfg.guard.ttlHours });
});

test('hook process: deny JSON on stdout, silent allow, exit 0 on garbage', () => {
  // The spawned process uses the real clock, so the marker must be fresh in real time.
  const d = proj({ markerRaw: JSON.stringify({ slug: 's', lane: 'FULL', stage: 'executing', updated: new Date().toISOString() }) });
  const run = (stdin) => spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8' });
  const denied = run(JSON.stringify(call(d, join(d, 'src', 'app.js'))));
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith('SDD guard: the team-lead session may not edit src'));
  const allowed = run(JSON.stringify(call(d, join(d, 'CONTEXT.md'))));
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
  for (const g of ['', 'not json', '{']) {
    const r = run(g);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('hooks.json registers the guard for Edit|Write|NotebookEdit with a quoted plugin-root path', () => {
  const h = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  const entry = h.hooks.PreToolUse[0];
  assert.equal(entry.matcher, 'Edit|Write|NotebookEdit');
  assert.equal(entry.hooks[0].type, 'command');
  assert.match(entry.hooks[0].command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/guard\.mjs"$/);
});
