import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanTasks } from '../bin/status.mjs';
import { detect } from '../bin/detect.mjs';
import { parseFrontmatter } from '../bin/index.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const headings = (text, level = 2) => [...text.matchAll(new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm'))].map((m) => m[1].trim());

// ---------- templates ----------
// A shipped template must itself be valid frontmatter (AC-1, AC-12).
function templateFields(rel, type) {
  const r = parseFrontmatter(read(rel));
  assert.ok(r.fields, `${rel} frontmatter: ${r.reason}`);
  assert.deepEqual(Object.keys(r.fields), ['type', 'title', 'description', 'status', 'timestamp']);
  assert.equal(r.fields.type, type);
  assert.equal(r.fields.status, 'draft');
  return r.fields;
}

test('spec template has every §7.1 heading, in order, and valid frontmatter', () => {
  const t = read('templates/spec.md');
  assert.deepEqual(headings(t), [
    'Goal', 'Background', 'Glossary terms', 'Requirements', 'Interfaces and contracts', 'Data and state',
    'Non-functional requirements', 'Risk areas', 'Decisions', 'Out of scope', 'Open questions',
    'Verification approach', 'Accepted risks',
  ]);
  templateFields('templates/spec.md', 'spec');
  assert.ok(!/^\*\*Date:\*\*/m.test(t));
  assert.ok(t.includes('Unhappy paths'));
  assert.ok(t.includes('AC-1'));
});

test('plan template has the header fields, matrix, and a parseable task block with every field label', () => {
  const t = read('templates/plan.md');
  templateFields('templates/plan.md', 'plan');
  for (const h of ['**Spec:**', '**Task count:**']) assert.ok(t.includes(h), h);
  assert.deepEqual(headings(t), ['Verify block', 'Accepted risks', 'Coverage matrix', 'Tasks']);
  const tasks = parsePlanTasks(t);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'T1');
  assert.equal(tasks[0].marker, ' ');
  const labels = ['Satisfies:', 'Depends on:', 'Lenses:', 'Router summary:', 'Files:', 'Consumes:', 'Produces:', 'Reuse:', 'Tests (complete):', 'Recipe:', 'Red:', 'Green:', 'Verify:', 'Commit:'];
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

// ---------- global rules ----------
function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    // Hidden directories are not part of the Kit layout (editor/tool caches such as .git and
    // .code-review-graph); .claude-plugin is the one hidden directory that is.
    if (e.isDirectory() && e.name.startsWith('.') && e.name !== '.claude-plugin') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

const EXPECTED_FILES = [
  '.gitattributes',
  '.claude-plugin/plugin.json',
  'agents/analyst.md', 'agents/developer.md', 'agents/planner.md', 'agents/reviewer.md',
  'bin/detect.mjs', 'bin/index.mjs', 'bin/route.mjs', 'bin/status.mjs',
  'commands/sdd-init.md', 'commands/sdd-status.md', 'commands/sdd.md',
  'config/detectors.json', 'config/sdd.config.default.json', 'config/sdd.config.schema.json',
  'hooks/guard.mjs', 'hooks/hooks.json',
  'playbook/team-lead.md',
  'templates/plan.md', 'templates/spec.md', 'templates/starter-context.md', 'templates/task-card.schema.json',
  'test/detect.test.mjs', 'test/guard.test.mjs', 'test/index.test.mjs', 'test/lint.test.mjs', 'test/route.test.mjs', 'test/status.test.mjs',
  'test/helpers/typesafe-mock.mjs',
];

test('AC-1: the file set is exactly the layout (fixtures excepted); plugin is named sdd', () => {
  const files = walk(ROOT).filter((f) => !f.startsWith('test/fixtures/'));
  assert.deepEqual(files.sort(), [...EXPECTED_FILES].sort());
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).name, 'sdd');
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, '0.2.0');
});

// Toolchain names (AC-2). config/detectors.json is the only Kit file allowed to contain them.
const BANNED = [
  'npm', 'yarn', 'pnpm', 'pip', 'cargo', 'maven', 'mvn', 'gradle', 'dotnet', 'msbuild', 'cmake', 'pytest', 'jest', 'vitest',
  'mocha', 'junit', 'xunit', 'nunit', 'rspec', 'phpunit', 'python', 'javascript', 'typescript', 'java', 'kotlin', 'rust',
  'golang', 'ruby', 'php',
];
const BANNED_RE = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i');

test('AC-2: no toolchain names in agents, commands, playbook, templates, bin or hooks', () => {
  const targets = walk(ROOT).filter((f) => /^(agents|commands|playbook|templates|bin|hooks)\//.test(f));
  assert.ok(targets.length >= 15);
  for (const f of targets) {
    const text = read(f);
    const m = BANNED_RE.exec(text);
    assert.equal(m, null, `${f} names a toolchain: ${m && m[0]}`);
    assert.ok(!/c#|\.net\b/i.test(text), `${f} names a toolchain (c# / .net)`);
  }
});

test('AC-3: scripts import only Node built-ins (sibling Kit modules where documented)', () => {
  const allowedRelative = { 'bin/status.mjs': ['./route.mjs'], 'bin/index.mjs': ['./route.mjs'] };
  for (const f of ['bin/route.mjs', 'bin/detect.mjs', 'bin/status.mjs', 'bin/index.mjs', 'hooks/guard.mjs']) {
    const text = read(f);
    assert.ok(!/\brequire\s*\(/.test(text), `${f} uses require`);
    assert.ok(!/\bimport\s*\(/.test(text), `${f} uses dynamic import`);
    const specs = [...text.matchAll(/^\s*import\b[^'"\n]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.ok(specs.length > 0, `${f} has imports`);
    for (const s of specs) {
      assert.ok(s.startsWith('node:') || (allowedRelative[f] ?? []).includes(s), `${f} imports ${s}`);
    }
  }
});

test('AC-4: no Kit file references another plugin or skill system', () => {
  const targets = walk(ROOT).filter((f) => !f.startsWith('test/') && !f.startsWith('.git'));
  for (const f of targets) {
    assert.ok(!/superpowers/i.test(read(f)), `${f} mentions superpowers`);
    assert.ok(!/\bSkill tool\b/.test(read(f)), `${f} invokes the Skill tool`);
  }
});

test('config/detectors.json is the one place toolchain names live', () => {
  assert.match(read('config/detectors.json'), /\bcargo\b/);
});

test('every playbook card/dispatch/section reference points at a heading that exists', () => {
  const t = read('playbook/team-lead.md');
  const have = new Set([...t.matchAll(/^## (\d+)\./gm)].map((m) => m[1]));
  for (const m of t.matchAll(/§(\d+)(?:\.\d+)?/g)) assert.ok(have.has(m[1]), `playbook references §${m[1]} but no such section`);
});

test('dry-run fixture repositories are detectable in two different ecosystems', () => {
  const js = detect(join(ROOT, 'test/fixtures/repo-js')).candidates;
  const py = detect(join(ROOT, 'test/fixtures/repo-py')).candidates;
  assert.equal(js[0].verify.test, 'npm test');
  assert.equal(py[0].verify.test, 'pytest');
});

test('dry-run scenario checklist covers the six scenarios of spec §10', () => {
  const t = read('test/fixtures/dry-run-scenarios.md');
  for (const h of [
    'Scenario 1 — QUICK happy path', 'Scenario 2 — FULL happy path', 'Scenario 3 — Risk-floor refusal',
    'Scenario 4 — Review stall', 'Scenario 5 — Task escalation to human', 'Scenario 6 — No-git project',
  ]) assert.ok(t.includes(`## ${h}`), h);
});

// ---------- v0.2: frontmatter status, Index, reuse check ----------
test('no Kit file outside test/ uses the bold Status line (status lives in the frontmatter)', () => {
  for (const f of walk(ROOT).filter((x) => !x.startsWith('test/'))) {
    assert.ok(!read(f).includes('**Status:**'), `${f} still names the bold Status line`);
  }
});

test('v0.2 rules are present in the agent prompts', () => {
  const must = {
    analyst: ['Index:', 'needs to exist', 'drafting dispatch', 'generated'],
    planner: ['Reuse:', 'none — searched', 'already-installed dependency', 'unless the spec itself names it'],
    developer: ['Reuse:', 'add nothing the recipe does not call for', 'rather than reimplementing'],
    reviewer: ['Reuse:', 'no `Reuse:` line', 'identical', 'frontmatter', 'should-fix'],
  };
  for (const [name, tokens] of Object.entries(must)) {
    const t = read(`agents/${name}.md`).toLowerCase();
    for (const tok of tokens) assert.ok(t.includes(tok.toLowerCase()), `${name}.md must contain ${JSON.stringify(tok)}`);
  }
});

test('playbook and /sdd-init run the Index script and define the status edit', () => {
  const t = read('playbook/team-lead.md');
  for (const tok of ['bin/index.mjs', 'status edit', 'cfg.paths.index', 'before the first analyst dispatch', '.*.tmp']) {
    assert.ok(t.includes(tok), `playbook must contain ${JSON.stringify(tok)}`);
  }
  assert.ok(/analyst\*\*\n```\n[\s\S]*?\nIndex: <cfg\.paths\.index>\n/.test(t), 'analyst dispatch template carries the Index line');
  assert.ok(read('commands/sdd-init.md').includes('bin/index.mjs'));
});

test('dry-run scenarios cover a task missing Reuse:, an analyst run with an Index, and an Unindexed legacy artifact', () => {
  const t = read('test/fixtures/dry-run-scenarios.md');
  for (const tok of ['Reuse:', 'Unindexed', 'docs/sdd/index.md']) assert.ok(t.includes(tok), tok);
});

// ---------- v0.3: resumable planning and size-gated slices ----------

test('v0.3 config: the two new limits are in the default config and the schema', () => {
  const def = JSON.parse(read('config/sdd.config.default.json'));
  assert.equal(def.limits.sliceMaxTasks, 12);
  assert.equal(def.limits.expandBatchTasks, 4);
  const schema = JSON.parse(read('config/sdd.config.schema.json'));
  assert.ok('sliceMaxTasks' in schema.properties.limits.properties);
  assert.ok('expandBatchTasks' in schema.properties.limits.properties);
});
