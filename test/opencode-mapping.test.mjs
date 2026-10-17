import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function frontmatter(rel) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(read(rel).replace(/\r\n/g, '\n'));
  assert.ok(m, `${rel} has frontmatter`);
  return Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

test('opencode commands: three commands, description kept, no Claude-only frontmatter', () => {
  for (const c of ['sdd', 'sdd-init', 'sdd-status']) {
    const fm = frontmatter(`.opencode/commands/${c}.md`);
    assert.ok(fm.description.length > 10, c);
    assert.ok(!('argument-hint' in fm), `${c} must not carry argument-hint`);
    assert.ok(!('name' in fm), `${c} must not carry name`);
    const body = read(`.opencode/commands/${c}.md`);
    assert.ok(!body.includes('${CLAUDE_PLUGIN_ROOT}'), `${c} must not reference CLAUDE_PLUGIN_ROOT`);
    assert.ok(body.includes('<kit>'), `${c} defines <kit>`);
  }
  assert.ok(read('.opencode/commands/sdd.md').includes('$ARGUMENTS'));
  assert.ok(read('.opencode/commands/sdd.md').includes('playbook/team-lead.md'));
  assert.ok(read('.opencode/commands/sdd-status.md').includes('bin/status.mjs'));
  assert.ok(read('.opencode/commands/sdd-init.md').includes('bin/detect.mjs'));
});

test('opencode agents: mode subagent, strict permission, no Claude-only frontmatter', () => {
  const perms = {
    analyst: { edit: 'allow', bash: 'allow' },
    planner: { edit: 'allow', bash: 'deny' },
    developer: { edit: 'allow', bash: 'allow' },
    reviewer: { edit: 'deny', bash: 'deny' },
  };
  for (const [name, want] of Object.entries(perms)) {
    const text = read(`.opencode/agents/${name}.md`).replace(/\r\n/g, '\n');
    const fm = frontmatter(`.opencode/agents/${name}.md`);
    assert.ok(fm.description.length > 20, name);
    assert.equal(fm.mode, 'subagent', name);
    assert.ok(!('name' in fm), `${name} must not carry name (filename is the name)`);
    assert.ok(!('tools' in fm), `${name} must not carry Claude tools allow-list`);
    assert.ok(text.includes('permission:'), `${name} declares permission`);
    assert.ok(text.includes(`edit: ${want.edit}`), `${name} edit permission`);
    assert.ok(text.includes(`bash: ${want.bash}`), `${name} bash permission`);
    // Body stays faithful to the Claude original (same return contract).
    const orig = read(`agents/${name}.md`);
    assert.ok(orig.includes(fm.description.slice(0, 24)), `${name} description matches Claude original`);
  }
});

test('opencode guard plugin: v1 named export wrapping hooks/guard.mjs', () => {
  const t = read('.opencode/plugins/sdd-guard.ts');
  assert.ok(t.includes('SddGuard'), 'named export SddGuard');
  assert.ok(t.includes('tool.execute.before'), 'registers tool.execute.before');
  assert.ok(t.includes('hooks/guard.mjs'), 'reuses hooks/guard.mjs');
  assert.ok(t.includes('SDD guard:'), 'rethrows the guard denial');
  const cfg = JSON.parse(read('.opencode/opencode.json'));
  assert.ok(Array.isArray(cfg.plugin), 'opencode.json registers plugin list');
  assert.ok(cfg.plugin.some((s) => String(s).includes('sdd-guard')), 'guard plugin registered');
});
