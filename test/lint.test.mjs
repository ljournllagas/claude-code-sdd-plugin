import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanTasks } from '../bin/status.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const headings = (text, level = 2) => [...text.matchAll(new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm'))].map((m) => m[1].trim());

// ---------- templates ----------
test('spec template has every §7.1 heading, in order, and a Status line', () => {
  const t = read('templates/spec.md');
  assert.deepEqual(headings(t), [
    'Goal', 'Background', 'Glossary terms', 'Requirements', 'Interfaces and contracts', 'Data and state',
    'Non-functional requirements', 'Risk areas', 'Decisions', 'Out of scope', 'Open questions',
    'Verification approach', 'Accepted risks',
  ]);
  assert.match(t, /^\*\*Status:\*\* draft$/m);
  assert.ok(t.includes('Unhappy paths'));
  assert.ok(t.includes('AC-1'));
});

test('plan template has the header fields, matrix, and a parseable task block with every field label', () => {
  const t = read('templates/plan.md');
  assert.match(t, /^\*\*Status:\*\* draft$/m);
  for (const h of ['**Spec:**', '**Task count:**']) assert.ok(t.includes(h), h);
  assert.deepEqual(headings(t), ['Verify block', 'Accepted risks', 'Coverage matrix', 'Tasks']);
  const tasks = parsePlanTasks(t);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'T1');
  assert.equal(tasks[0].marker, ' ');
  const labels = ['Satisfies:', 'Depends on:', 'Lenses:', 'Router summary:', 'Files:', 'Consumes:', 'Produces:', 'Tests (complete):', 'Recipe:', 'Red:', 'Green:', 'Verify:', 'Commit:'];
  let at = t.indexOf('### T1');
  for (const l of labels) {
    const i = t.indexOf(l, at);
    assert.ok(i > at, `label ${l} missing or out of order`);
    at = i;
  }
});

test('task-card schema lists the seven stages and the optional fields', () => {
  const s = JSON.parse(read('templates/task-card.schema.json'));
  assert.deepEqual(s.required, ['stage']);
  assert.deepEqual(s.properties.stage.enum, ['triage', 'analyst', 'planner', 'developer', 'reviewer-spec', 'reviewer-plan', 'reviewer-code']);
  assert.deepEqual(Object.keys(s.properties).sort(), ['failures_at_last_tier', 'files_touched', 'last_tier', 'paths', 'stage', 'summary', 'tasks_downstream', 'tasks_upstream']);
});

test('starter context is a glossary skeleton', () => {
  const t = read('templates/starter-context.md');
  assert.match(t, /^# CONTEXT\.md/m);
  assert.ok(t.includes('One term per entry'));
});
