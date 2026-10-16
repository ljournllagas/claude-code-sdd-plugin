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
function templateFields(rel, type, extra = []) {
  const r = parseFrontmatter(read(rel));
  assert.ok(r.fields, `${rel} frontmatter: ${r.reason}`);
  assert.deepEqual(Object.keys(r.fields), ['type', 'title', 'description', 'status', 'timestamp', ...extra]);
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

test('plan template is a split-plan manifest: valid frontmatter with layout, header fields and the manifest sections', () => {
  const t = read('templates/plan.md');
  const fields = templateFields('templates/plan.md', 'plan', ['layout']);
  assert.equal(fields.layout, 'split');
  for (const h of ['**Spec:**', '**Task count:**']) assert.ok(t.includes(h), h);
  assert.deepEqual(headings(t), ['Verify block', 'Accepted risks', 'Coverage matrix', 'Slices', 'Task index']);
  assert.equal(parsePlanTasks(t).length, 0, 'the manifest holds no task headings');
  assert.ok(t.includes('- Slice 1'));
  assert.ok(t.includes(' · slice 1 · ACs: '));
  assert.ok(t.includes('summary: '));
});

test('task template is one task block: heading first, every field label in order', () => {
  const t = read('templates/task.md');
  assert.ok(t.startsWith('### T1 — '), 'a task file starts with its heading');
  const tasks = parsePlanTasks(t);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'T1');
  assert.equal(tasks[0].marker, ' ');
  const labels = ['Satisfies:', 'Depends on:', 'Lenses:', 'Router summary:', 'Files:', 'Consumes:', 'Produces:', 'Reuse:', 'Tests (complete):', 'Recipe:', 'Red:', 'Green:', 'Verify:', 'Commit:'];
  let at = 0;
  for (const l of labels) {
    const i = t.indexOf(l, at);
    assert.ok(i !== -1 && i >= at, `label ${l} missing or out of order`);
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
  analyst: 'Read, Glob, Grep, Write, Edit, Bash',
  planner: 'Read, Glob, Grep, Write, Edit',
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
    planner: ['PLAN: ', 'TASKS: ', 'SLICES: ', 'EXPANDED: ', 'OUTLINE-GAP: ', 'MODE: OUTLINE', 'MODE: EXPAND', 'Slice cap', 'one `Write` call per task file', 'SPEC-GAP: ', 'Verify block', 'verbatim', 'Check:', 'Manual:', 'none — no test command configured', 'Router summary', '5 files'],
    developer: ['Task file:', 'TASK-DONE ', 'TASK-BLOCKED: ', 'design-gap', 'defect', 'environment', 'Files changed:', 'Files created:', 'Red:', 'Green:', 'FF DISPATCH', 'QUICK'],
    reviewer: ['Scope:', 'outline', 'MODE: spec', 'MODE: plan', 'MODE: code', 'Score:', 'Blockers (', 'Should-fix (', 'Solid:', 'Verdict:', 'Ready', 'Blockers must be resolved first', 'security', 'data', 'contract', 'performance', 'LENSES:'],
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

test('analyst revisions go through Edit, never a whole-file Write', () => {
  const t = read('agents/analyst.md');
  assert.match(t, /each change with `Edit` on the spec file/);
  assert.match(t, /never rewrite the whole file with `Write`/);
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
// The playbook is a core file plus chapters the team-lead reads on demand; each section lives in exactly one file.
const PLAYBOOK_FILES = {
  'playbook/team-lead.md': ['## 0. Ground rules', '## 1. Start-up', '## 2. Triage', '## 11. Finish and report', '## 12. Dispatch reference'],
  'playbook/quick.md': ['## 3. Lane QUICK'],
  'playbook/full.md': ['## 4. Lane FULL — spec stage', '## 5. Review loop (spec and plan)', '## 6. Lane FULL — plan stage', '## 8. Post-execution review (FULL)'],
  'playbook/execution.md': ['## 7. Execution (FULL)'],
  'playbook/amendments.md': ['## 9. Amendments after approval'],
  'playbook/stops.md': ['## 10. Stop points'],
  'playbook/resume.md': ['## 13. Resume'],
  'playbook/legacy.md': ['## 14. Legacy plans'],
};
const playbook = () => Object.keys(PLAYBOOK_FILES).map(read).join('\n');

test('playbook: every section lives in exactly one file, in order; the core maps every chapter', () => {
  for (const [file, heads] of Object.entries(PLAYBOOK_FILES)) {
    const t = read(file);
    assert.deepEqual(headings(t), heads.map((h) => h.slice(3)), `${file} sections`);
  }
  const core = read('playbook/team-lead.md');
  for (const file of Object.keys(PLAYBOOK_FILES).slice(1)) assert.ok(core.includes(`<kit>/${file}`), `the core names ${file}`);
  assert.ok(core.trimEnd().endsWith('<!-- END PLAYBOOK -->'));
  assert.ok(core.length < 26000, `the core stays small (${core.length} characters)`);
});

test('playbook part A: key rules and tokens are present', () => {
  const t = playbook();
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

test('playbook part B: execution, review, amendment, stop and finish rules are present', () => {
  const t = playbook();
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
  'CHANGELOG.md',
  'README.md',
  'agents/analyst.md', 'agents/developer.md', 'agents/planner.md', 'agents/reviewer.md',
  'bin/card.mjs', 'bin/cite-check.mjs', 'bin/detect.mjs', 'bin/doctor.mjs', 'bin/index.mjs', 'bin/marker.mjs', 'bin/outcome.mjs', 'bin/plan.mjs', 'bin/route.mjs', 'bin/scope-check.mjs', 'bin/status-edit.mjs', 'bin/status.mjs', 'bin/task-done.mjs', 'bin/verify-waiver.mjs', 'bin/verify.mjs',
  'commands/sdd-init.md', 'commands/sdd-status.md', 'commands/sdd.md',
  'config/detectors.json', 'config/sdd.config.default.json', 'config/sdd.config.schema.json',
  'hooks/guard.mjs', 'hooks/hooks.json',
  'playbook/amendments.md', 'playbook/execution.md', 'playbook/full.md', 'playbook/legacy.md', 'playbook/quick.md', 'playbook/resume.md', 'playbook/stops.md', 'playbook/team-lead.md',
  'templates/plan.md', 'templates/spec.md', 'templates/starter-context.md', 'templates/task-card.schema.json', 'templates/task.md',
  'test/card.test.mjs', 'test/cite-check.test.mjs', 'test/detect.test.mjs', 'test/doctor.test.mjs', 'test/guard.test.mjs', 'test/index.test.mjs', 'test/lint.test.mjs', 'test/marker.test.mjs', 'test/outcome.test.mjs', 'test/plan.test.mjs', 'test/route.test.mjs', 'test/scope-check.test.mjs', 'test/status-edit.test.mjs', 'test/status.test.mjs', 'test/task-done.test.mjs', 'test/verify-waiver.test.mjs', 'test/verify.test.mjs',
  'test/helpers/project.mjs', 'test/helpers/typesafe-mock.mjs',
];

test('AC-1: the file set is exactly the layout (fixtures excepted); plugin is named sdd', () => {
  const files = walk(ROOT).filter((f) => !f.startsWith('test/fixtures/'));
  assert.deepEqual(files.sort(), [...EXPECTED_FILES].sort());
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).name, 'sdd');
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, '0.6.15');
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
  const allowedRelative = {
    'bin/status.mjs': ['./route.mjs', './plan.mjs', './outcome.mjs'], 'bin/index.mjs': ['./route.mjs'], 'bin/plan.mjs': ['./route.mjs', './index.mjs'],
    'bin/outcome.mjs': ['./route.mjs', './marker.mjs'], 'bin/marker.mjs': ['./route.mjs', './plan.mjs'],
    'bin/card.mjs': ['./route.mjs', './plan.mjs', './marker.mjs'], 'bin/verify.mjs': ['./route.mjs', './plan.mjs', './marker.mjs', './verify-waiver.mjs'],
    'bin/task-done.mjs': ['./route.mjs', './plan.mjs', './marker.mjs', './outcome.mjs'], 'bin/verify-waiver.mjs': ['./route.mjs'],
    'bin/cite-check.mjs': ['./index.mjs'],
  };
  for (const f of ['bin/route.mjs', 'bin/detect.mjs', 'bin/status.mjs', 'bin/index.mjs', 'bin/plan.mjs', 'bin/outcome.mjs', 'bin/marker.mjs', 'bin/card.mjs', 'bin/verify.mjs', 'bin/task-done.mjs', 'bin/verify-waiver.mjs', 'bin/cite-check.mjs', 'hooks/guard.mjs']) {
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
  const t = playbook();
  const have = new Set([...t.matchAll(/^## (\d+)\./gm)].map((m) => m[1]));
  assert.equal(have.size, 15, 'sections 0-14');
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
  const t = playbook();
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

test('v0.3 playbook: outline, expansion, slices, scopes, resume and the plan-check stop are present', () => {
  const t = playbook();
  const tokens = [
    'outline-draft', 'outline-review', 'outline-approval', 'approved_slices', 'limits.sliceMaxTasks', 'limits.expandBatchTasks',
    'MODE: OUTLINE', 'MODE: EXPAND', 'OUTLINE-GAP', 'bin/plan.mjs', 'Scope: outline', 'Scope: slice', 'Scope: plan',
    'Task file:', 'Plan check failed', 'Legacy plans', 'never re-dispatch a task whose file exists',
    'Never dispatch a task of a slice that is not in `approved_slices`', 'Split plans.',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `playbook must contain ${JSON.stringify(tok)}`);
});

test('v0.3 dry-run scenarios cover cutoff resume, the size gate and a legacy plan', () => {
  const t = read('test/fixtures/dry-run-scenarios.md');
  for (const h of ['Scenario 10 — Cutoff during task expansion', 'Scenario 11 — Size gate and slices', 'Scenario 12 — Legacy single-file plan']) {
    assert.ok(t.includes(`## ${h}`), h);
  }
});

// ---------- v0.3 final-review fixes ----------
test('v0.3 playbook: resume tells mid-expansion from requested changes; legacy, return_stage, progress and total rules are present', () => {
  const t = playbook();
  const tokens = [
    // review records carry a scope, so resume can tell "changes requested at a gate" from "cut mid-expansion"
    '· scope slice <n>', 'records with `scope outline`', 'records with `scope slice <n>`',
    // legacy detection and the legacy plan paragraph
    'a run at `plan-draft` or later with no `slice` is a legacy run', 'the plan file already exists, so no planner dispatch is needed', 'a legacy run, whose marker has no `slice`, is exempt',
    // amendments
    'OUTLINE-GAP` raised while a plan is first being written', '"outline-draft"|"plan-draft"', 'set `slice.total`', 'Mechanical check after an amendment',
    // runaway expansion
    'made no progress',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `playbook must contain ${JSON.stringify(tok)}`);
});

// ---------- outcome logging (spec 2026-10-13-sdd-outcome-logging) ----------
test('outcome logging: the playbook states the marker shape, the line rules and the quoting', () => {
  const t = playbook();
  const tokens = [
    'bin/outcome.mjs',
    // AC-9: the one new marker field, shown in the exact entry shape
    '{attempt_tier, last_tier, failures_at_last_tier, in_progress, routed}',
    // AC-10 to AC-16: the paragraph and its rules
    '**Outcome line.**', 'first_attempt', 'subagent_tokens', 'duration_ms',
    'A user\'s answer never produces a line', 'never writes a line for a verdict reached before the cut',
    'double-quote the `--reason` value',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `playbook must contain ${JSON.stringify(tok)}`);
  // no counter was added to the marker
  assert.ok(!t.includes('`attempts`'), 'the marker has no attempts counter');
});

test('outcome logging: the dry-run checklist covers outcome lines', () => {
  const t = read('test/fixtures/dry-run-scenarios.md');
  assert.ok(t.includes('## Scenario 13 — Outcome lines'));
  for (const tok of ['first_attempt', 'routed', 'outcome.mjs', 'I fixed it']) assert.ok(t.includes(tok), tok);
});

test('v0.3 planner prompt: amendments keep the index in agreement; EXPAND copies dependencies\' Produces', () => {
  const t = read('agents/planner.md');
  for (const tok of ['update its entry in the manifest', 'copy that task\'s `Produces` signatures verbatim']) {
    assert.ok(t.includes(tok), `planner.md must contain ${JSON.stringify(tok)}`);
  }
});

// ---------- v0.6: token savings and the audit fixes ----------
test('v0.6 agent prompts: starting paths, light specs, caps, grounding notes, the runner, task-aware code review', () => {
  const must = {
    analyst: ['Starting paths:', 'Spec size: light', 'AC cap:', 'searching outward only'],
    planner: ['Grounding notes:', 'Task file line cap:', 'append each new verified fact', 'in its own backticks', 'both use the targeted `testOne` command'],
    developer: ['Runner:', 'verify.mjs', '**except** the Verify block\'s `test` command', 'Start from the brief\'s expected paths', 'grows past 5 files'],
    reviewer: ['Review only these blocks', 'Scripts check the mechanics', 'Goal:', 'Plan:', 'an AC that no change implements is a blocker', 'Spec size: light'],
  };
  for (const [name, tokens] of Object.entries(must)) {
    const t = read(`agents/${name}.md`);
    for (const tok of tokens) assert.ok(t.includes(tok), `${name}.md must contain ${JSON.stringify(tok)}`);
  }
  // the reviewer no longer re-checks what scripts check
  const r = read('agents/reviewer.md');
  assert.ok(!r.includes('check with Glob'), 'path existence is plan.mjs check --paths');
  assert.ok(!r.includes('opens and closes with `---`'), 'the frontmatter block is cite-check.mjs');
});

test('v0.6 playbook: the scripts carry the bookkeeping and every prompt carries what its agent needs', () => {
  const t = playbook();
  const tokens = [
    'bin/marker.mjs', 'bin/card.mjs', 'bin/verify.mjs', 'bin/task-done.mjs', 'bin/doctor.mjs', '--from-marker', '--record <key>', '--retry <key>', '--resume <key>',
    'Starting paths:', 'Spec size:', 'AC cap: <cfg.limits.maxAcceptanceCriteria>', 'Grounding notes: .sdd/<slug>.grounding.md', 'Task file line cap: <cfg.limits.maxTaskFileLines>',
    '[Goal: <the QUICK brief\'s goal>]', '[Plan: <manifest path>]', 'Runner: node "<kit>/bin/verify.mjs"', '--paths', 'verify.external', 'never Write or Edit the file yourself',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `playbook must contain ${JSON.stringify(tok)}`);
});

test('v0.6 config: the final code review never routes below standard', () => {
  assert.equal(JSON.parse(read('config/sdd.config.default.json')).stageFloors['reviewer-code'], 'standard');
});

// ---------- v0.6.1: developer audit fixes ----------
test('v0.6.1 developer: Red evidence, green-only TASK-DONE, bounded re-runs, scope self-check, files on a block', () => {
  const t = read('agents/developer.md');
  const tokens = [
    'fails for **another reason**', 'Return `TASK-DONE` only when every command this step requires passed', 'stop after 3 rounds', 'flaky: judge it by its last run', 'Notes:',
    'Commands write files too', 'Before you return', 'a `Reuse:` item that is missing or does not fit', 'no reformatting or reordering',
    'failed: <the line showing the stated reason>', 'Evidence:', 'naming, style and idiom',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  const blocked = t.slice(t.indexOf('TASK-BLOCKED: <class> — <reason>\nFiles changed:'));
  assert.ok(blocked.includes('Files created:'), 'a TASK-BLOCKED return lists the files it touched');
  assert.ok(playbook().includes(`Runner: node "<kit>/bin/verify.mjs" --cmd '<command>'`), 'the dispatch quotes the command as the developer prompt does');
});

// ---------- v0.6.2: developer re-audit fixes ----------
test('v0.6.2 developer: lane-wide minimum change, fixed tests, start snapshot, bounded rounds, no hardcoding', () => {
  const t = read('agents/developer.md');
  const always = t.slice(t.indexOf('## Always'), t.indexOf('## Contract (FULL)'));
  for (const tok of ['**Smallest change.**', 'Do not refactor beyond the task', 'rather than reimplementing', 'unless the recipe, task or brief names it'])
    assert.ok(always.includes(tok), `the Always rules (QUICK included) must contain ${JSON.stringify(tok)}`);
  const tokens = [
    'Do not special-case test inputs or hardcode expected values', 'or after 5 rounds in total', 'formatter or auto-fix (`--fix`, `--write`) unless the task names it',
    'Never change the task\'s test code after you wrote it', 'If the task\'s test code is not in its test files yet, write it as given first',
    '**start snapshot**', 'Never touch a path outside the Files list that is in the start snapshot', 'Leave no trace', 'skipped (<Check | Manual | FF DISPATCH: tests already present | QUICK>)',
    'Manual — left to the user', 'paths undone outside the Files list',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  assert.ok(!t.includes('files you did not create in this attempt'), 'FF protects paths edited before the attempt, not only files the developer did not create');
  assert.ok(!playbook().includes('files you did not create in this attempt'), 'the FF dispatch line agrees with the developer prompt');
  assert.match(t, /^description: Executes exactly one SDD plan task with test-first discipline \(or one QUICK brief\)/m);
});

// ---------- v0.6.3: developer audit fixes ----------
test('v0.6.3 developer: defined rounds, diagnostic run, guidance scope, diff check, Notes on a block', () => {
  const t = read('agents/developer.md');
  const tokens = [
    'A `User guidance:` line narrows how you do the work, never what it covers', 'for a review fix, the path of the review record',
    'this diagnostic run is not a round', 'A round is one code change followed by the `Green:`',
    'narrowed or not', 'fixes only the blockers marked `fix`', '(after creating the empty shell <path>)', "<the runner's line>",
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  const blocked = t.slice(t.indexOf('TASK-BLOCKED: <class> — <reason>\nFiles changed:'));
  assert.ok(blocked.includes('Notes:'), 'a TASK-BLOCKED return can name undone paths and flaky commands');
  assert.equal((t.match(/add no dependency/g) ?? []).length, 0, 'the dependency rule lives once, in Smallest change');
});

// ---------- v0.6.4: developer audit fixes ----------
test('v0.6.4 developer: fresh pass after the last change, additive tests, QUICK self-check, evidence-based file lists', () => {
  const t = read('agents/developer.md');
  const tokens = [
    'that run came after your last code change', 'If this step undid a path, run `Green:` (or `Check:`) and the step-4 commands once more',
    'if the task needs that change, return `TASK-BLOCKED: design-gap` naming the path; otherwise undo it',
    'add the tests and keep the existing ones', 'record the start snapshot before you edit anything', 'in place of the Files list',
    'Take `Files changed` and `Files created` from the step-6 comparison', 'Rounds: <n>', 'quick-fix (a review fix)',
    'names existing code, a standard-library feature or a dependency', 'the same command failing on the same first error line', 'never decides a result',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  assert.ok(read('agents/planner.md').includes('For a test file the task modifies, give only the tests to add'), 'the planner says whether given tests add or replace');
  const quick = playbook().slice(playbook().indexOf('**developer — QUICK**'));
  assert.ok(quick.slice(0, quick.indexOf('### 12.3')).includes('[User guidance: <text>]'), 'the QUICK dispatch template carries User guidance');
});

// ---------- v0.6.5: developer audit fixes ----------
test('v0.6.5 developer: Manual tasks, CONTEXT.md terms, exact stop rules, project root, QUICK scope', () => {
  const t = read('agents/developer.md');
  const tokens = [
    '**Manual task**', 'a Manual task: none — Manual', 'read it first and name domain concepts with its terms',
    'stop after 3 rounds in a row', 'at most once per command between two code changes', 'never `cd` away from it',
    'run Red once more (not a round), which must now fail for the stated reason', 'if that run fails, fixing it is a round',
    'A `create` path that already exists when you start is a design gap',
    'existing code that duplicates what a `Reuse: none` task builds', 'when the brief has no such line, run none',
    'outside the brief\'s expected paths under `Notes:`', 'Change no build, CI or tool configuration or lockfile unless the goal names it',
    'Each command line reports that command\'s last run',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  for (const f of ['agents/planner.md', 'templates/task.md']) {
    const s = read(f);
    assert.ok(s.includes('write no `Check:` line'), `${f} defines a Manual task as one with no Check: line`);
    assert.ok(!s.includes('or `Manual:` steps when none exist'), `${f} no longer puts Manual steps in place of Red/Green`);
  }
});

// ---------- v0.6.6: developer audit fixes ----------
test('v0.6.6 developer: non-interactive commands, binding names, QUICK reuse, pre-existing failures, full BLOCKED report', () => {
  const t = read('agents/developer.md');
  const tokens = [
    'Run every command non-interactively', '`tail -n 200`', '`verify.timeoutMinutes`',
    'Use the names and signatures the task gives', 'the task\'s names win, then `CONTEXT.md` terms',
    'unless the surrounding code documents every symbol of that kind',
    'is new, even when it is installed as a dependency of another one',
    'A brief has no `Reuse:` line, so before you write new logic, search the repository',
    '`TASK-BLOCKED: environment — pre-existing failure: <command>`',
    'including one that already carried edits when the attempt started',
    'Red: <as in TASK-DONE, or not run>', 'Green: <as in TASK-DONE, or not run>', 'Verify: <as in TASK-DONE, or not run>',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  assert.equal(JSON.parse(read('config/sdd.config.default.json')).verify.timeoutMinutes, 30);
  assert.ok('timeoutMinutes' in JSON.parse(read('config/sdd.config.schema.json')).properties.verify.properties);
});

// ---------- v0.6.7: developer audit fixes ----------
test('v0.6.7 developer: Red proven or flagged, no-test runs fail, bounded diagnostics, full BLOCKED notes', () => {
  const t = read('agents/developer.md');
  const tokens = [
    'add `--expect-tests` before `--cmd`', 'a `Red:` or `Green:` that ran no tests',
    'run `Red:` once (not a round) before you change any implementation', 'not proven (FF: <why>)',
    'Red is waived only when the test code was already in place',
    'and that run is the result',
    'paths undone outside the Files list, QUICK paths outside the expected paths, QUICK reuse, or none>\n```\n\nReturn only that block',
  ];
  for (const tok of tokens) assert.ok(t.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  assert.ok(read('playbook/execution.md').includes('adding `tasks.<key>.red_proven=true` to the same command'));
  assert.ok(read('playbook/full.md').includes('`Red unproven:` with the IDs of the done tasks'));
  assert.ok(read('playbook/team-lead.md').includes('[Red unproven: <task IDs>]'));
  assert.ok(read('agents/reviewer.md').includes('A `Red unproven: <task IDs>` line names tasks'));
  const rules = JSON.parse(read('config/detectors.json')).noTestsRan;
  assert.ok(rules.match.length > 0 && rules.units.length > 0);
});

// ---------- v0.6.8: fixes from the first real dry run ----------
test('v0.6.8: QUICK narrowing from the brief, relative paths, reported diff review, template-only dispatches, verbatim records', () => {
  const dev = read('agents/developer.md');
  for (const tok of [
    "the brief's `Narrow tests:` template", 'as paths relative to the project root',
  ]) assert.ok(dev.includes(tok), `developer.md must contain ${JSON.stringify(tok)}`);
  const lead = read('playbook/team-lead.md');
  assert.ok(lead.includes('[Narrow tests: <cfg.verify.testOne>]'));
  assert.ok(lead.includes('A dispatch prompt holds only its template\'s lines'));
  assert.ok(read('playbook/quick.md').includes('the reviewer\'s whole return, copied unchanged'));
  assert.ok(read('playbook/full.md').includes('the reviewer\'s whole return, copied unchanged'));
  assert.ok(read('agents/planner.md').includes('`Verify:` is the exception: it uses only the Verify block\'s commands'));
});

// ---------- v0.6.9: fixes from the dry-run re-run ----------
test('v0.6.9: one closing status-and-diff command, no Diff review claim, suite health stop, no invented stops, passing Verify', () => {
  const dev = read('agents/developer.md');
  assert.ok(!dev.includes('Diff review:'), 'a self-reported review line invites unbacked claims');
  const exec = read('playbook/execution.md');
  assert.ok(exec.includes('Never stop on your own judgment that a retry cannot help'));
  assert.ok(read('playbook/stops.md').includes('**Suite already failing**'));
  const lead = read('playbook/team-lead.md');
  assert.ok(lead.includes('Verify set (the team-lead runs it after you; you run only its non-test commands)'));
  assert.equal(lead.split('`<command>` stays a placeholder').length - 1, 2);
  assert.ok(read('agents/planner.md').includes('every `Green:` and `Verify:` expects a pass') || read('agents/planner.md').includes('Every `Green:` and `Verify:` expects a pass'));
  assert.ok(read('agents/reviewer.md').includes('one that expects a failure is a blocker'));
});

// ---------- v0.6.10: developer self-review dropped ----------
test('v0.6.10: the developer keeps the stray-path check but no diff self-review; the code reviewer covers naming and stray edits', () => {
  const dev = read('agents/developer.md');
  assert.ok(!/git diff/.test(dev), 'developer.md no longer asks for a git diff review');
  assert.ok(dev.includes('compare `git status --porcelain --untracked-files=all` with the start snapshot and the Files list'));
  assert.ok(read('agents/reviewer.md').includes("names and comments that break the repository's conventions"));
});

// ---------- v0.6.11: suite health at run start ----------
test('v0.6.11: the suite health check runs right after lane confirmation, before any agent, in both lanes', () => {
  const lead = read('playbook/team-lead.md');
  assert.ok(lead.includes('**Suite health:** when `verify.test` is set, run it once'));
  assert.ok(!read('playbook/execution.md').includes('Suite health'), 'no second check before the first task');
  assert.ok(read('playbook/stops.md').includes('(§2 step 6: `verify.test` fails before any agent ran)'));
});

// ---------- v0.6.12: a planner SPEC-GAP is a recorded stop ----------
test('v0.6.12: SPEC-GAP stops at §10 "Spec gap" with Decide / Abort before any amendment', () => {
  const stops = read('playbook/stops.md');
  assert.ok(stops.includes('**Spec gap** (the planner returned `SPEC-GAP: …`'));
  assert.ok(stops.includes('- **Decide** → the user\'s answer, verbatim, goes with the finding to the analyst'));
  assert.ok(read('playbook/full.md').includes('stop with §10 "Spec gap"; on **Decide**, handle it as a spec amendment (§9)'));
});
