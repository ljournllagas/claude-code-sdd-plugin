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

// ---------- agents ----------
function frontmatter(rel) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(read(rel).replace(/\r\n/g, '\n'));
  assert.ok(m, `${rel} has frontmatter`);
  return Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

const AGENT_TOOLS = {
  analyst: 'Read, Glob, Grep, Write, Bash',
  planner: 'Read, Glob, Grep, Write',
  developer: 'Read, Glob, Grep, Edit, Write, Bash',
  reviewer: 'Read, Glob, Grep',
};
for (const [name, tools] of Object.entries(AGENT_TOOLS)) {
  test(`agent ${name}: frontmatter name, description and tool set`, () => {
    const fm = frontmatter(`agents/${name}.md`);
    assert.equal(fm.name, name);
    assert.ok(fm.description.length > 20);
    assert.equal(fm.tools, tools);
    assert.ok(!('model' in fm), 'model is chosen per dispatch by the Router');
  });
}

test('agent return formats the playbook parses are documented', () => {
  const must = {
    analyst: ['SPEC: ', 'OPEN QUESTIONS (', 'OPEN QUESTIONS: none', '[BLOCKING|NON-BLOCKING]', 'Recommended:', 'docs/sdd/specs/', 'CONTEXT.md'],
    planner: ['PLAN: ', 'TASKS: ', 'SPEC-GAP: ', 'Verify block', 'verbatim', 'Check:', 'Manual:', 'none — no test command configured', 'Router summary', '5 files'],
    developer: ['TASK-DONE ', 'TASK-BLOCKED: ', 'design-gap', 'defect', 'environment', 'Files changed:', 'Files created:', 'Red:', 'Green:', 'FF DISPATCH', 'QUICK'],
    reviewer: ['MODE: spec', 'MODE: plan', 'MODE: code', 'Score:', 'Blockers (', 'Should-fix (', 'Solid:', 'Verdict:', 'Ready', 'Blockers must be resolved first', 'security', 'data', 'contract', 'performance', 'LENSES:'],
  };
  for (const [name, tokens] of Object.entries(must)) {
    const t = read(`agents/${name}.md`);
    for (const tok of tokens) assert.ok(t.includes(tok), `${name}.md must contain ${JSON.stringify(tok)}`);
  }
});

test('agents never edit outside their remit (instruction text present)', () => {
  assert.match(read('agents/analyst.md'), /never write (or edit )?code/i);
  assert.match(read('agents/developer.md'), /outside the task's Files list/i);
  assert.match(read('agents/reviewer.md'), /never modify/i);
});

// ---------- commands ----------
test('exactly three commands with descriptions', () => {
  assert.deepEqual(readdirSync(join(ROOT, 'commands')).sort(), ['sdd-init.md', 'sdd-status.md', 'sdd.md']);
  for (const c of ['sdd', 'sdd-init', 'sdd-status']) assert.ok(frontmatter(`commands/${c}.md`).description.length > 10, c);
});

test('/sdd loads the playbook and passes the arguments', () => {
  const t = read('commands/sdd.md');
  assert.ok(t.includes('playbook/team-lead.md'));
  assert.ok(t.includes('$ARGUMENTS'));
  assert.ok(t.includes('${CLAUDE_PLUGIN_ROOT}'));
});

test('/sdd-init covers AC-27 and AC-28', () => {
  const t = read('commands/sdd-init.md');
  for (const tok of ['bin/detect.mjs', 'sdd.config.json', 'docs/sdd/specs', 'docs/sdd/plans', 'CONTEXT.md', 'starter-context.md', '.gitignore', '.sdd/', 'never overwrite', 'null', '--check-config']) {
    assert.ok(t.includes(tok), `sdd-init.md must contain ${JSON.stringify(tok)}`);
  }
});

test('/sdd-status runs the status script and nothing else', () => {
  const t = read('commands/sdd-status.md');
  assert.ok(t.includes('bin/status.mjs'));
  assert.ok(t.includes('--check-config') === false);
});

// ---------- playbook ----------
const PLAYBOOK_A = [
  '## 0. Ground rules', '## 1. Start-up', '## 2. Triage', '## 3. Lane QUICK', '## 4. Lane FULL — spec stage',
  '## 5. Review loop (spec and plan)', '## 6. Lane FULL — plan stage', '## 12. Dispatch reference',
];

test('playbook part A: headings present and in order', () => {
  const t = read('playbook/team-lead.md');
  let at = -1;
  for (const h of PLAYBOOK_A) {
    const i = t.indexOf(`\n${h}\n`);
    assert.ok(i > at, `${h} missing or out of order`);
    at = i;
  }
  assert.ok(t.trimEnd().endsWith('<!-- END PLAYBOOK -->'));
});

test('playbook part A: key rules and tokens are present', () => {
  const t = read('playbook/team-lead.md');
  const tokens = [
    // ground rules (AC-10a, AC-13, AC-32)
    'never edit the content of a spec or plan', 'exact single-line replacement', 'never infer approval', '.sdd/active.json', 'updated',
    // start-up (AC-30, AC-32, AC-34, §8)
    '--check-config', 'run /sdd-init first', 'sdd end', 'guard.ttlHours', 'resume', 'never two runs at once',
    // triage (AC-5, AC-8, AC-9)
    '▸ triage:', 'No delegation happens before confirmation', 'Risk floor', 'riskKeywords', 'raise', 'split this', 'at most one search',
    // QUICK (AC-6)
    'QUICK verify set', 'never format', 'quick-dev', 'quick-review', 'quick-fix', 'dirty_at_start', 'uncommitted', 'brief', 'TASK-BLOCKED',
    // spec stage and loop (AC-7, AC-10, AC-13)
    'questionRounds', 'limits.openQuestions', 'in-review', 'approved', 'stall', 'cap hit', 'did not review', 'rejected:', 'Dispositions', 'Never run a round', 'new loop', 'Exit: ', '# Loop ',
    // plan stage
    'SPEC-GAP', 'Task count', 'Verify:',
    // dispatch reference (AC-5, AC-16)
    'bin/route.mjs', '.sdd/card.json', 'subagent_type', 'effort', 'MODE: ', 'LENSES:', 'FF DISPATCH', 'git add -N', 'git reset -q', '.fail.txt', 'last 40 lines',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `playbook must contain ${JSON.stringify(tok)}`);
});

const PLAYBOOK_B = [
  '## 7. Execution (FULL)', '## 8. Post-execution review (FULL)', '## 9. Amendments after approval',
  '## 10. Stop points', '## 11. Finish and report',
];

test('playbook part B: headings between §6 and §12, in order; insertion marker removed', () => {
  const t = read('playbook/team-lead.md');
  assert.ok(!t.includes('INSERTED HERE BY TASK 16'));
  let at = t.indexOf('\n## 6. Lane FULL — plan stage\n');
  assert.ok(at > 0);
  for (const h of [...PLAYBOOK_B, '## 12. Dispatch reference']) {
    const i = t.indexOf(`\n${h}\n`);
    assert.ok(i > at, `${h} missing or out of order`);
    at = i;
  }
});

test('playbook part B: execution, review, amendment, stop and finish rules are present', () => {
  const t = read('playbook/team-lead.md');
  const tokens = [
    // §7 (AC-11, AC-29, AC-34)
    'executing', 'pre-flight', 'dirty_at_start', 'never re-recorded', 'in_progress', 'attempt_tier', 'failures_at_last_tier', 'last_tier',
    'fresh developer', 'FF dispatch', 'fix-forward', 'increments', 'does not increment', 'TASK-BLOCKED', 'design-gap', 'git commit', 'Manual:', 'outside the task\'s Files list',
    // §8 (AC-12)
    'run diff', 'reviewFixRounds', 'code-review', 'review-fix', 'fix tasks',
    // §9 (AC-12a)
    'Amendment', 'counters reset', 'Review only these blocks', 'draft',
    // §10 (§8.1 table rows)
    'Review stall or cap hit', 'Direct', 'Accept', 'Reject as out of scope', 'Abort', 'Task needs a human', 'I fixed it', 'Retry at deep with guidance', 'Skip',
    'Analyst questions unanswered', 'Answer now', 'Proceed with assumptions', 'Verify set empty', 'Confirm done', 'Not done',
    'Leftover edits', 'Keep', 'Revert', 'Dirty-files pre-flight', 'Ready', 'Risk-floor refusal', 'Rescope',
    // §11
    'unreviewed', 'Accepted risks', 'delete `.sdd/active.json`',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `playbook must contain ${JSON.stringify(tok)}`);
});
