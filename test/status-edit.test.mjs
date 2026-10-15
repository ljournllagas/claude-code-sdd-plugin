import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../bin/status-edit.mjs';

const CLI = fileURLToPath(new URL('../bin/status-edit.mjs', import.meta.url));
const front = (type, status, extra = '') => ['---', `type: ${type}`, 'title: Demo', 'description: A demo.', `status: ${status}`, 'timestamp: 2026-10-15', extra, '---', '', '# Demo', 'status: draft', ''].filter((l, i) => l !== '' || i > 6).join('\n');

test('setStatus changes only the frontmatter status line', () => {
  const text = front('plan', 'approved');
  const r = S.setStatus(text, 'executing');
  assert.equal(r.from, 'approved');
  assert.equal(r.text, text.replace('status: approved', 'status: executing'));
  assert.ok(r.text.includes('\nstatus: draft\n'), 'a body line that reads status: is untouched');
});

test('setStatus keeps CRLF line endings and a BOM, and is a no-op when the status is already set', () => {
  const text = `﻿${front('spec', 'draft')}`.replace(/\n/g, '\r\n');
  const r = S.setStatus(text, 'in-review');
  assert.equal(r.text, text.replace('status: draft\r\ntimestamp', 'status: in-review\r\ntimestamp'));
  assert.equal(S.setStatus(text, 'draft').text, text);
});

test('setStatus refuses a status the type does not have, a missing frontmatter and a missing status line', () => {
  assert.match(S.setStatus(front('spec', 'draft'), 'executing').error, /executing is not a spec status/);
  assert.equal(S.setStatus('# no frontmatter\n', 'done').error, 'no frontmatter');
  assert.match(S.setStatus('---\ntype: plan\ntitle: x\n---\n', 'done').error, /no status line/);
  assert.match(S.setStatus('---\ntype: note\nstatus: draft\n---\n', 'done').error, /not spec or plan/);
});

test('CLI: edits the file, prints one line, refreshes the Index; a second call says already; errors exit 1, usage exits 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd status '));
  mkdirSync(join(d, 'docs', 'sdd', 'plans'), { recursive: true });
  mkdirSync(join(d, 'docs', 'sdd', 'specs'), { recursive: true });
  const plan = join(d, 'docs', 'sdd', 'plans', 'demo.md');
  writeFileSync(plan, front('plan', 'approved'));
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8' });
  const r = run(plan, 'done');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `status ${plan}: approved → done\n`);
  assert.match(readFileSync(plan, 'utf8'), /^status: done$/m);
  assert.match(readFileSync(join(d, 'docs', 'sdd', 'index.md'), 'utf8'), /Demo\]\(plans\/demo\.md\) — done/);
  assert.equal(run(plan, 'done').stdout, `status ${plan}: already done\n`);
  assert.equal(run(plan, 'bogus').status, 1);
  assert.equal(run(join(d, 'missing.md'), 'done').status, 1);
  assert.equal(run(plan).status, 2);
  assert.equal(existsSync(`${plan}.tmp`), false);
});
