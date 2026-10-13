import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../bin/plan.mjs';

const PLAN_CLI = fileURLToPath(new URL('../bin/plan.mjs', import.meta.url));

// ---------- builders ----------
// A task is { id, title, slice, acs, deps, files, summary }. Three tasks in two slices by default.
const TASKS = [
  { id: 'T1', title: 'Add helper', slice: 1, acs: ['AC-1'], deps: [], files: ['src/a.js', 'test/a.test.js'], summary: 'Add the helper.' },
  { id: 'T2', title: 'Wire helper', slice: 1, acs: ['AC-2'], deps: ['T1'], files: ['src/b.js'], summary: 'Wire the helper in.' },
  { id: 'T3', title: 'Document it', slice: 2, acs: ['AC-3'], deps: ['T2'], files: ['docs/b.md'], summary: 'Document the wiring.' },
];
const SLICES = [{ n: 1, title: 'Core' }, { n: 2, title: 'Docs' }];

function manifest({ tasks = TASKS, slices = SLICES, count = tasks.length, layout = 'split', matrix, fm = {} } = {}) {
  const rows = matrix ?? [...new Set(tasks.flatMap((t) => t.acs))].map((ac) => `| ${ac} | ${tasks.filter((t) => t.acs.includes(ac)).map((t) => t.id).join(', ')} |`);
  const front = { type: 'plan', title: 'Demo', description: 'A demo plan.', status: 'draft', timestamp: '2026-10-13', layout, ...fm };
  return [
    '---', ...Object.entries(front).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`), '---', '',
    '# Demo — Plan', '', '**Spec:** docs/sdd/specs/demo.md', `**Task count:** ${count}`, '',
    '## Verify block', '', '- test: `node --test`', '',
    '## Accepted risks', '', 'None', '',
    '## Coverage matrix', '', '| AC | Tasks |', '|---|---|', ...rows, '',
    '## Slices', '', ...slices.map((s) => `- Slice ${s.n} — ${s.title}`), '',
    '## Task index', '',
    ...tasks.flatMap((t) => [
      `- ${t.id} — ${t.title} · slice ${t.slice} · ACs: ${t.acs.join(', ') || 'none'} · deps: ${t.deps.join(', ') || 'none'} · files: ${t.files.map((f) => `\`${f}\``).join(', ')}`,
      ...(t.summary === null ? [] : [`  summary: ${t.summary}`]),
    ]),
    '',
  ].join('\n');
}

function taskFile(t, { marker = '[ ] pending', verify = true, heading = `### ${t.id} — ${t.title}   ${marker}`, extra = '' } = {}) {
  return [
    heading,
    `Satisfies: ${t.acs.join(', ')}`,
    `Depends on: ${t.deps.join(', ') || 'none'}`,
    'Lenses: none',
    `Router summary: ${t.summary}`,
    'Files:',
    ...t.files.map((f) => `  - modify  ${f}     (symbol: X)`),
    'Consumes:  none',
    'Produces:  X',
    'Reuse:     none — searched src/, nothing to reuse',
    'Tests (complete):',
    '```js',
    'Verify: this line is inside a fence and must not count',
    '```',
    'Recipe: 1. Do it.',
    'Red:    node --test → expected: fails because X is missing',
    'Green:  node --test → expected: passes',
    ...(verify ? ['Verify: node --test → expected: passes'] : []),
    `Commit: add ${t.id}`,
    extra,
  ].join('\n');
}

// Writes a split plan into a fresh project directory (the name contains a space) and returns paths.
function project({ tasks = TASKS, slices = SLICES, expanded = tasks.map((t) => t.id), manifestOpts = {}, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sdd plan '));
  const plans = join(dir, 'docs', 'sdd', 'plans');
  mkdirSync(join(plans, 'demo'), { recursive: true });
  writeFileSync(join(plans, 'demo.md'), manifest({ tasks, slices, ...manifestOpts }));
  for (const t of tasks) if (expanded.includes(t.id)) writeFileSync(join(plans, 'demo', `${t.id}.md`), files[t.id] ?? taskFile(t));
  return { dir, manifest: join(plans, 'demo.md'), rel: 'docs/sdd/plans/demo.md' };
}

// The demo plan has two slices of at most two tasks, so the slice cap is 2 unless a test says otherwise.
const check = (p, opts) => P.checkPlan(P.loadPlan(p.manifest), { sliceMax: 2, ...opts });

// ---------- parsing ----------
test('parsePlanTasks reads id, title and marker (unchanged since v0.2)', () => {
  const text = ['### T1 — A   [x] done', '### T2 — B [with brackets]   [!] blocked', 'Not a heading: ### T9 — nope   [x] done', '### T3 — C [x]'].join('\n');
  assert.deepEqual(P.parsePlanTasks(text), [
    { id: 'T1', title: 'A', marker: 'x' }, { id: 'T2', title: 'B [with brackets]', marker: '!' }, { id: 'T3', title: 'C', marker: 'x' },
  ]);
});

test('parseTaskBlock reads heading, lists and files; a Verify line inside a code fence does not count', () => {
  const p = P.parseTaskBlock(taskFile(TASKS[1]));
  assert.equal(p.id, 'T2');
  assert.equal(p.title, 'Wire helper');
  assert.equal(p.marker, ' ');
  assert.deepEqual(p.satisfies, ['AC-2']);
  assert.deepEqual(p.dependsOn, ['T1']);
  assert.equal(p.routerSummary, 'Wire the helper in.');
  assert.deepEqual(p.files, ['src/b.js']);
  assert.equal(p.hasVerify, true);
  const fenceOnly = P.parseTaskBlock(taskFile(TASKS[1], { verify: false }));
  assert.equal(fenceOnly.hasVerify, false);
});

test('parseManifest reads frontmatter, slices, index entries, summaries and the coverage matrix', () => {
  const m = P.parseManifest(manifest());
  assert.equal(m.layout, 'split');
  assert.equal(m.count, 3);
  assert.equal(m.spec, 'docs/sdd/specs/demo.md');
  assert.deepEqual(m.slices, [{ n: 1, title: 'Core' }, { n: 2, title: 'Docs' }]);
  assert.deepEqual(m.index[0], { id: 'T1', title: 'Add helper', slice: 1, acs: ['AC-1'], deps: [], files: ['src/a.js', 'test/a.test.js'], summary: 'Add the helper.' });
  assert.deepEqual(m.index[2].deps, ['T2']);
  assert.deepEqual(m.matrix, [{ ac: 'AC-1', tasks: ['T1'] }, { ac: 'AC-2', tasks: ['T2'] }, { ac: 'AC-3', tasks: ['T3'] }]);
  assert.deepEqual(m.badIndexLines, []);
});

test('parseManifest: a plan without layout is legacy "single"; HTML comments in the manifest are ignored', () => {
  assert.equal(P.parseManifest(manifest({ fm: { layout: undefined } })).layout, 'single');
  assert.equal(P.parseManifest(manifest({ layout: 'single' })).layout, 'single');
  const withComment = manifest().replace('## Slices', '<!-- - T9 — fake · slice 1 · ACs: AC-9 · deps: none · files: `x` -->\n## Slices');
  assert.equal(P.parseManifest(withComment).index.length, 3);
});

test('parseManifest reports unparseable index lines', () => {
  const broken = manifest().replace('· slice 1 · ACs: AC-1', '· ACs: AC-1');
  const m = P.parseManifest(broken);
  assert.equal(m.index.length, 2);
  assert.equal(m.badIndexLines.length, 1);
});

// ---------- loading and the tasks listing ----------
test('loadPlan: split plan with one task not yet expanded; markers come from task files', () => {
  const p = project({ expanded: ['T1', 'T2'], files: { T1: taskFile(TASKS[0], { marker: '[x] done' }) } });
  const plan = P.loadPlan(p.manifest);
  assert.equal(plan.layout, 'split');
  assert.deepEqual(plan.tasks.map((t) => [t.id, t.expanded, t.marker]), [['T1', true, 'x'], ['T2', true, ' '], ['T3', false, ' ']]);
  assert.deepEqual(plan.slices, [{ n: 1, title: 'Core', tasks: ['T1', 'T2'] }, { n: 2, title: 'Docs', tasks: ['T3'] }]);
});

test('loadPlan: a missing task folder means nothing is expanded; an unlisted task file is an orphan', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd plan '));
  mkdirSync(join(d, 'plans'));
  writeFileSync(join(d, 'plans', 'demo.md'), manifest());
  assert.deepEqual(P.loadPlan(join(d, 'plans', 'demo.md')).tasks.map((t) => t.expanded), [false, false, false]);
  const p = project({ files: {} });
  writeFileSync(join(p.manifest, '..', 'demo', 'T9.md'), '### T9 — Stray   [ ] pending\n');
  assert.deepEqual(P.loadPlan(p.manifest).orphans, ['T9.md']);
});

test('loadPlan: legacy single-file plan lists every heading as expanded in one slice', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd plan '));
  const legacy = ['---', 'type: plan', 'title: Old', 'status: executing', '---', '', '**Task count:** 2', '', taskFile(TASKS[0], { marker: '[x] done' }), '', taskFile(TASKS[1])].join('\n');
  writeFileSync(join(d, 'old.md'), legacy);
  const plan = P.loadPlan(join(d, 'old.md'));
  assert.equal(plan.layout, 'single');
  assert.deepEqual(plan.tasks.map((t) => [t.id, t.marker, t.expanded, t.slice]), [['T1', 'x', true, 1], ['T2', ' ', true, 1]]);
  assert.deepEqual(P.checkPlan(plan), []);
});

test('summarizePlan: JSON-ready listing with project-relative slash paths', () => {
  const p = project({ expanded: ['T1'] });
  const s = P.summarizePlan(P.loadPlan(p.manifest), p.dir);
  assert.equal(s.layout, 'split');
  assert.equal(s.count, 3);
  assert.deepEqual(s.tasks[0], { id: 'T1', title: 'Add helper', slice: 1, marker: ' ', expanded: true, file: 'docs/sdd/plans/demo/T1.md' });
  assert.equal(s.tasks[2].expanded, false);
});

// ---------- checks ----------
test('check: a consistent split plan is ok at every scope', () => {
  const p = project();
  assert.deepEqual(check(p, { scope: 'plan' }), []);
  assert.deepEqual(check(p, { scope: 'outline' }), []);
  assert.deepEqual(check(p, { scope: 'slice', slice: 2 }), []);
});

test('check outline: task count mismatch, duplicate ID, unparseable line', () => {
  assert.deepEqual(check(project({ manifestOpts: { count: 5 } }), { scope: 'outline' }), ['manifest: Task count 5 but 3 index entries']);
  const dup = [...TASKS, { ...TASKS[2], title: 'Again' }];
  const d = check(project({ tasks: dup, expanded: [] }), { scope: 'outline' });
  assert.ok(d.includes('T3: duplicate task ID'), d.join('\n'));
});

test('check outline: slice rules — size gate, order, fits-one-slice, unlisted slice', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `T${i + 1}`, title: `Task ${i + 1}`, slice: 1, acs: [`AC-${i + 1}`], deps: i ? [`T${i}`] : [], files: [`src/f${i}.js`], summary: 's' }));
  const gate = P.checkPlan(P.loadPlan(project({ tasks: many, slices: [{ n: 1, title: 'All' }], expanded: [] }).manifest), { scope: 'outline', sliceMax: 4 });
  assert.deepEqual(gate, ['manifest: slice 1 has 5 tasks (limit 4)']);
  const fits = check(project({ expanded: [] }), { scope: 'outline', sliceMax: 12 });
  assert.deepEqual(fits, ['manifest: 3 tasks fit one slice (limit 12) but 2 slices are listed']);
  const later = [{ ...TASKS[0], slice: 2 }, TASKS[1], TASKS[2]];
  assert.ok(check(project({ tasks: later, expanded: [] }), { scope: 'outline', sliceMax: 2 }).includes('T2: depends on T1 in a later slice'));
  const unlisted = [TASKS[0], TASKS[1], { ...TASKS[2], slice: 7 }];
  assert.ok(check(project({ tasks: unlisted, expanded: [] }), { scope: 'outline', sliceMax: 2 }).includes('T3: slice 7 is not listed under Slices'));
  assert.ok(check(project({ slices: [{ n: 1, title: 'A' }, { n: 3, title: 'B' }], expanded: [] }), { scope: 'outline', sliceMax: 2 }).includes('manifest: slice 3 is out of sequence (expected 2)'));
});

test('check outline: unknown dependency, forward dependency and a two-task cycle', () => {
  const t = [{ ...TASKS[0], deps: ['T9'] }, { ...TASKS[1], deps: ['T3'] }, { ...TASKS[2], deps: ['T2'] }];
  const d = check(project({ tasks: t, expanded: [] }), { scope: 'outline', sliceMax: 2 });
  assert.ok(d.includes('T1: depends on unknown task T9'));
  assert.ok(d.includes('T2: depends on T3, which is not listed before it'));
  const cycle = [{ ...TASKS[0], deps: ['T2'] }, { ...TASKS[1], deps: ['T1'] }];
  const c = check(project({ tasks: cycle, slices: [{ n: 1, title: 'A' }], expanded: [] }), { scope: 'outline' });
  assert.ok(c.includes('T1: depends on T2, which is not listed before it'));
});

test('check outline: file cap, missing AC, summary rules, coverage matrix', () => {
  const t = [
    { ...TASKS[0], files: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { ...TASKS[1], acs: [], summary: null },
    { ...TASKS[2], summary: 'x'.repeat(501) },
  ];
  const d = check(project({ tasks: t, slices: [{ n: 1, title: 'A' }, { n: 2, title: 'B' }], expanded: [] }), { scope: 'outline', sliceMax: 2 });
  assert.ok(d.includes('T1: touches 6 files (limit 5)'));
  assert.ok(d.includes('T2: cites no AC'));
  assert.ok(d.includes('T2: has no summary line'));
  assert.ok(d.includes('T3: summary is longer than 500 characters'));
  const matrix = check(project({ manifestOpts: { matrix: ['| AC-1 | T1 |', '| AC-2 | T1 |', '| AC-3 | T7 |'] }, expanded: [] }), { scope: 'outline', sliceMax: 2 });
  assert.ok(matrix.includes('T2: AC-2 is not mapped to it in the coverage matrix'));
  assert.ok(matrix.includes('manifest: coverage matrix maps AC-3 to unknown task T7'));
});

test('check with --spec: every spec AC needs a task; cited ACs must exist', () => {
  const p = project({ expanded: [] });
  const spec = '- **AC-1** a\n- **AC-2** b\n- **AC-3** c\n- **AC-4** d\n';
  assert.deepEqual(check(p, { scope: 'outline', spec, sliceMax: 2 }), ['manifest: AC-4 has no task in the coverage matrix']);
  const small = '- **AC-1** a\n- **AC-2** b\n';
  assert.deepEqual(check(p, { scope: 'outline', spec: small, sliceMax: 2 }), ['T3: cites AC-3, which is not in the spec']);
});

test('check slice/plan: unexpanded task, disagreement with the index, missing Verify, orphan', () => {
  const unexpanded = project({ expanded: ['T1', 'T2'] });
  assert.deepEqual(check(unexpanded, { scope: 'slice', slice: 1 }), []);
  assert.deepEqual(check(unexpanded, { scope: 'slice', slice: 2 }), ['T3: not expanded (no task file)']);
  assert.deepEqual(check(unexpanded, { scope: 'plan' }), ['T3: not expanded (no task file)']);

  const drift = project({ files: {
    T1: taskFile({ ...TASKS[0], acs: ['AC-9'], deps: ['T3'], files: ['src/other.js'], summary: 'Changed.' }),
    T2: taskFile(TASKS[1], { verify: false }),
    T3: taskFile(TASKS[2], { heading: '### T4 — Document it   [ ] pending' }),
  } });
  const d = check(drift, { scope: 'plan' });
  for (const want of [
    'T1: Satisfies differs from the index ACs', 'T1: Depends on differs from the index', 'T1: Files differ from the index',
    'T1: Router summary differs from the index summary', 'T2: no Verify: line', 'T3: file heading names T4',
  ]) assert.ok(d.includes(want), `${want}\n${d.join('\n')}`);

  const orphan = project();
  writeFileSync(join(orphan.manifest, '..', 'demo', 'T9.md'), '### T9 — Stray   [ ] pending\n');
  assert.deepEqual(check(orphan, { scope: 'plan' }), ['T9: task file is not in the index']);
});

test('check: legacy plan — Task count and Verify lines', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdd plan '));
  const text = ['---', 'type: plan', 'title: Old', 'status: draft', '---', '**Task count:** 3', taskFile(TASKS[0]), taskFile(TASKS[1], { verify: false })].join('\n');
  writeFileSync(join(d, 'old.md'), text);
  assert.deepEqual(P.checkPlan(P.loadPlan(join(d, 'old.md'))), ['manifest: Task count 3 but 2 task headings', 'T2: no Verify: line']);
});

// ---------- CLI ----------
const cli = (cwd, ...args) => spawnSync(process.execPath, [PLAN_CLI, ...args], { cwd, encoding: 'utf8' });

test('CLI tasks: prints one JSON object; exit 0', () => {
  const p = project({ expanded: ['T1'] });
  const r = cli(p.dir, 'tasks', p.rel);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.count, 3);
  assert.equal(s.tasks[0].file, 'docs/sdd/plans/demo/T1.md');
});

test('CLI check: ok exits 0; defects exit 1, one per line; --slice and --spec are honoured', () => {
  const ok = cli(project().dir, 'check', 'docs/sdd/plans/demo.md', '--plan');
  assert.equal(ok.status, 1, 'default limit 12 makes two slices of three tasks a defect');
  assert.equal(ok.stdout.trim(), 'manifest: 3 tasks fit one slice (limit 12) but 2 slices are listed');
  const one = project({ slices: [{ n: 1, title: 'All' }], tasks: TASKS.map((t) => ({ ...t, slice: 1 })) });
  const good = cli(one.dir, 'check', one.rel, '--plan');
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(good.stdout.trim(), 'ok');
  const spec = join(one.dir, 'spec.md');
  writeFileSync(spec, '- **AC-1** a\n- **AC-2** b\n- **AC-3** c\n- **AC-4** d\n');
  const missing = cli(one.dir, 'check', one.rel, '--outline', '--spec', 'spec.md');
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout.trim(), 'manifest: AC-4 has no task in the coverage matrix');
  const sl = cli(one.dir, 'check', one.rel, '--slice', '1');
  assert.equal(sl.status, 0, sl.stdout);
});

test('CLI: usage errors exit 2; an unreadable manifest exits 1 with one stderr line; a bad config is reported', () => {
  const p = project();
  assert.equal(cli(p.dir).status, 2);
  assert.equal(cli(p.dir, 'check').status, 2);
  assert.equal(cli(p.dir, 'check', p.rel, '--slice', 'x').status, 2);
  assert.equal(cli(p.dir, 'tasks', p.rel, '--outline').status, 2);
  const gone = cli(p.dir, 'tasks', 'nope.md');
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /plan\.mjs: cannot read nope\.md: ENOENT/);
  writeFileSync(join(p.dir, 'sdd.config.json'), JSON.stringify({ limits: { sliceMaxTasks: 0 } }));
  const bad = cli(p.dir, 'check', p.rel, '--outline');
  assert.ok(bad.stderr.includes('limits.sliceMaxTasks'), bad.stderr);
});

// ---------- Review Focus: inputs the happy path never meets ----------
test('CRLF line endings parse like LF (Windows checkouts)', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  const m = P.parseManifest(crlf(manifest()));
  assert.equal(m.layout, 'split');
  assert.equal(m.index.length, 3);
  assert.equal(m.index[0].summary, 'Add the helper.');
  assert.deepEqual(m.matrix.map((r) => r.ac), ['AC-1', 'AC-2', 'AC-3']);
  const p = P.parseTaskBlock(crlf(taskFile(TASKS[1])));
  assert.deepEqual([p.id, p.marker, p.satisfies, p.files, p.routerSummary, p.hasVerify], ['T2', ' ', ['AC-2'], ['src/b.js'], 'Wire the helper in.', true]);
});

test('a Files path containing spaces is written in backticks and still parses', () => {
  const t = { ...TASKS[0], files: ['src/my dir/a.js'] };
  const block = taskFile(t).replace('  - modify  src/my dir/a.js     (symbol: X)', '  - modify  `src/my dir/a.js`     (symbol: X)');
  assert.deepEqual(P.parseTaskBlock(block).files, ['src/my dir/a.js']);
});

test('an outline whose only slice has no tasks is a defect, never ok', () => {
  const p = project({ tasks: [], slices: [{ n: 1, title: 'All' }], expanded: [], manifestOpts: { count: 0, matrix: [] } });
  assert.deepEqual(check(p, { scope: 'outline' }), ['manifest: slice 1 has no tasks']);
});

// ---------- final-review fixes ----------
test('a fix task appended to an executed slice does not make later slice checks fail the cap', () => {
  const fix = { id: 'T4', title: 'Fix it', slice: 1, acs: ['AC-1'], deps: ['T2'], files: ['src/fix.js'], summary: 'Fix.' };
  const tasks = [...TASKS, fix]; // slice 1 now holds T1, T2, T4: one over the cap of 2
  const executed = project({ tasks, files: { T1: taskFile(TASKS[0], { marker: '[x] done' }) } });
  assert.deepEqual(check(executed, { scope: 'slice', slice: 2 }), []);
  const notStarted = project({ tasks });
  assert.ok(check(notStarted, { scope: 'slice', slice: 2 }).includes('manifest: slice 1 has 3 tasks (limit 2)'));
});

test('a manifest without layout: split is named as such, never ok and never read as a legacy plan', () => {
  const p = project({ manifestOpts: { fm: { layout: undefined } }, expanded: [] });
  for (const opts of [{ scope: 'outline' }, { scope: 'slice', slice: 1 }]) {
    const d = check(p, opts);
    assert.equal(d.length, 1, d.join('\n'));
    assert.match(d[0], /^manifest: not a split plan \(frontmatter lacks layout: split\)/);
  }
  const plan = check(p, { scope: 'plan' });
  assert.deepEqual(plan, ['manifest: has Slices or a Task index but its frontmatter lacks layout: split']);
  const empty = project({ tasks: [], slices: [], expanded: [], manifestOpts: { count: 0, matrix: [], fm: { layout: undefined } } });
  assert.notDeepEqual(check(empty, { scope: 'outline' }), []);
});

test('check input handling: --spec needs a value; an unknown --slice is a defect, never ok', () => {
  const one = project({ slices: [{ n: 1, title: 'All' }], tasks: TASKS.map((t) => ({ ...t, slice: 1 })) });
  assert.equal(cli(one.dir, 'check', one.rel, '--plan', '--spec').status, 2);
  const s = cli(one.dir, 'check', one.rel, '--slice', '9');
  assert.equal(s.status, 1);
  assert.ok(s.stdout.includes('manifest: slice 9 is not listed under Slices'), s.stdout);
});
