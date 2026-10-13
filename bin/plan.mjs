#!/usr/bin/env node
// SDD plan: reads a plan in either layout (one file, or a manifest plus one file per task), lists its tasks
// and checks it mechanically. Read-only. Node built-ins only, plus sibling Kit modules.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join, relative } from 'node:path';
import { loadConfig } from './route.mjs';
import { parseFrontmatter } from './index.mjs';

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const toLines = (t) => stripBom(String(t)).split(/\r?\n/);
const toSlash = (p) => p.replace(/\\/g, '/');
const splitList = (v) => (v === '' || /^none\b/i.test(v) ? [] : v.split(',').map((s) => s.trim()).filter(Boolean));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export const TASK_RE = /^### (T\d+) — (.+?)\s+\[([ x!])\](?: (?:pending|done|blocked|skipped))?\s*$/;
const LABELS = ['Satisfies', 'Depends on', 'Lenses', 'Router summary', 'Files', 'Consumes', 'Produces', 'Reuse', 'Tests (complete)', 'Recipe', 'Red', 'Green', 'Check', 'Verify', 'Commit'];
const LABEL_RE = new RegExp('^(' + LABELS.map((l) => l.replace(/[()]/g, '\\$&')).join('|') + '):[ \\t]*(.*)$');
const ENTRY_RE = /^- (T\d+) — (.+?) · slice (\d+) · ACs: (.*?) · deps: (.*?) · files: (.*)$/;
const FENCE_RE = /^\s*```/;

// The heading marker of every task in a plan text. Unchanged since v0.2.
export function parsePlanTasks(text) {
  const tasks = [];
  for (const line of toLines(text)) {
    const m = TASK_RE.exec(line);
    if (m) tasks.push({ id: m[1], title: m[2], marker: m[3] });
  }
  return tasks;
}

// One task block (heading plus fields). Lines inside a code fence are never read as fields.
export function parseTaskBlock(text) {
  const out = { id: null, title: null, marker: null, satisfies: [], dependsOn: [], routerSummary: null, files: [], hasVerify: false };
  let inFence = false;
  let current = null;
  for (const line of toLines(text)) {
    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = TASK_RE.exec(line);
    if (h && out.id === null) { [, out.id, out.title, out.marker] = h; continue; }
    const m = LABEL_RE.exec(line);
    if (m) {
      current = m[1];
      const v = m[2].trim();
      if (current === 'Satisfies') out.satisfies = splitList(v);
      else if (current === 'Depends on') out.dependsOn = splitList(v);
      else if (current === 'Router summary') out.routerSummary = v;
      else if (current === 'Verify') out.hasVerify = true;
      continue;
    }
    if (current === 'Files') {
      const f = /^\s*-\s+(?:create|modify)\s+(?:`([^`]+)`|(\S+))/.exec(line);
      if (f) out.files.push(f[1] ?? f[2]);
    }
  }
  return out;
}

function splitBlocks(text) {
  const blocks = [];
  let inFence = false;
  for (const line of toLines(text)) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence && TASK_RE.test(line)) blocks.push([]);
    if (blocks.length > 0) blocks[blocks.length - 1].push(line);
  }
  return blocks.map((b) => b.join('\n'));
}

function sectionLines(lines, heading) {
  const i = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < lines.length && !/^## /.test(lines[j]); j++) out.push(lines[j]);
  return out;
}

// The manifest of a split plan, or the header of a legacy plan (then only `layout`, `count` and `fields` are meaningful).
export function parseManifest(text) {
  const clean = stripBom(String(text)).replace(/<!--[\s\S]*?-->/g, '');
  const fm = parseFrontmatter(clean);
  const lines = toLines(clean);
  const countM = /^\*\*Task count:\*\*\s*(\d+)\s*$/m.exec(clean);
  const specM = /^\*\*Spec:\*\*\s*(.+?)\s*$/m.exec(clean);
  const slices = [];
  for (const l of sectionLines(lines, 'Slices')) {
    const m = /^- Slice (\d+) — (.+?)\s*$/.exec(l);
    if (m) slices.push({ n: Number(m[1]), title: m[2] });
  }
  const index = [];
  const badIndexLines = [];
  const idx = sectionLines(lines, 'Task index');
  for (let i = 0; i < idx.length; i++) {
    if (!idx[i].startsWith('- ')) continue;
    const m = ENTRY_RE.exec(idx[i]);
    if (!m) { badIndexLines.push(idx[i]); continue; }
    const s = /^\s+summary:\s*(.*?)\s*$/.exec(idx[i + 1] ?? '');
    index.push({
      id: m[1], title: m[2], slice: Number(m[3]), acs: splitList(m[4]), deps: splitList(m[5]),
      files: [...m[6].matchAll(/`([^`]+)`/g)].map((x) => x[1]), summary: s ? s[1] : null,
    });
  }
  const matrix = [];
  for (const l of sectionLines(lines, 'Coverage matrix')) {
    const m = /^\|\s*(AC-\d+[a-z]?)\s*\|\s*(.*?)\s*\|\s*$/.exec(l);
    if (m) matrix.push({ ac: m[1], tasks: m[2].match(/T\d+/g) ?? [] });
  }
  return {
    fields: fm.fields ?? null,
    frontmatterReason: fm.reason ?? null,
    layout: fm.fields?.layout === 'split' ? 'split' : 'single',
    spec: specM ? specM[1] : null,
    count: countM ? Number(countM[1]) : null,
    slices, index, badIndexLines, matrix,
  };
}

// Loads a plan in either layout. A task is expanded when its file exists (a legacy plan's tasks always are).
export function loadPlan(manifestPath) {
  const text = stripBom(readFileSync(manifestPath, 'utf8'));
  const manifest = parseManifest(text);
  if (manifest.layout === 'single') {
    const tasks = splitBlocks(text).map((b) => {
      const parsed = parseTaskBlock(b);
      return { id: parsed.id, title: parsed.title, slice: 1, marker: parsed.marker, expanded: true, file: manifestPath, entry: null, parsed };
    });
    return { layout: 'single', manifestPath, manifest, tasks, slices: [{ n: 1, title: 'All tasks', tasks: tasks.map((t) => t.id) }], orphans: [] };
  }
  const dir = join(dirname(manifestPath), basename(manifestPath, '.md'));
  const tasks = manifest.index.map((entry) => {
    const file = join(dir, `${entry.id}.md`);
    const expanded = existsSync(file);
    const parsed = expanded ? parseTaskBlock(readFileSync(file, 'utf8')) : null;
    return { id: entry.id, title: entry.title, slice: entry.slice, marker: parsed?.marker ?? ' ', expanded, file, entry, parsed };
  });
  const known = new Set(manifest.index.map((e) => e.id));
  let orphans = [];
  try { orphans = readdirSync(dir).filter((f) => /^T\d+\.md$/.test(f) && !known.has(f.slice(0, -3))).sort(); } catch { /* no task folder yet */ }
  const slices = manifest.slices.map((s) => ({ ...s, tasks: manifest.index.filter((e) => e.slice === s.n).map((e) => e.id) }));
  return { layout: 'split', manifestPath, manifest, tasks, slices, orphans };
}

export function summarizePlan(plan, base = process.cwd()) {
  return {
    layout: plan.layout,
    count: plan.tasks.length,
    slices: plan.slices,
    tasks: plan.tasks.map((t) => ({
      id: t.id, title: t.title, slice: t.slice, marker: t.marker, expanded: t.expanded, file: toSlash(relative(base, t.file)),
    })),
  };
}

const specAcIds = (text) => [...new Set([...String(text).matchAll(/\*\*(AC-\d+[a-z]?)\*\*/g)].map((m) => m[1]))];

// Mechanical checks. scope: 'outline' (manifest only), 'slice' (outline plus that slice's task files), 'plan' (everything).
// Returns one defect string per problem, `<T-id or manifest>: <problem>`, in a stable order.
export function checkPlan(plan, { scope = 'plan', slice = null, spec = null, sliceMax = 12 } = {}) {
  const defects = [];
  const add = (who, msg) => defects.push(`${who}: ${msg}`);
  const m = plan.manifest;

  if (plan.layout === 'single') {
    if (m.count === null) add('manifest', 'no Task count');
    else if (m.count !== plan.tasks.length) add('manifest', `Task count ${m.count} but ${plan.tasks.length} task headings`);
    for (const t of plan.tasks) if (!t.parsed.hasVerify) add(t.id, 'no Verify: line');
    return defects;
  }

  if (m.fields === null) add('manifest', `invalid frontmatter (${m.frontmatterReason})`);
  if (m.count === null) add('manifest', 'no Task count');
  else if (m.count !== m.index.length) add('manifest', `Task count ${m.count} but ${m.index.length} index entries`);
  for (const l of m.badIndexLines) add('manifest', `unparseable index line: ${l.slice(0, 60)}`);

  const byId = new Map();
  for (const e of m.index) {
    if (byId.has(e.id)) add(e.id, 'duplicate task ID');
    byId.set(e.id, e);
  }

  if (m.slices.length === 0) add('manifest', 'no slices listed');
  m.slices.forEach((s, i) => { if (s.n !== i + 1) add('manifest', `slice ${s.n} is out of sequence (expected ${i + 1})`); });
  const listed = new Set(m.slices.map((s) => s.n));
  for (const e of m.index) if (!listed.has(e.slice)) add(e.id, `slice ${e.slice} is not listed under Slices`);
  for (const s of m.slices) {
    const n = m.index.filter((e) => e.slice === s.n).length;
    if (n === 0) add('manifest', `slice ${s.n} has no tasks`);
    if (n > sliceMax) add('manifest', `slice ${s.n} has ${n} tasks (limit ${sliceMax})`);
  }
  if (m.index.length <= sliceMax && m.slices.length > 1) {
    add('manifest', `${m.index.length} tasks fit one slice (limit ${sliceMax}) but ${m.slices.length} slices are listed`);
  }

  // A dependency must exist, sit in the same or an earlier slice, and be listed before its dependant (which also rules out cycles).
  const pos = new Map(m.index.map((e, i) => [e.id, i]));
  for (const e of m.index) {
    for (const d of e.deps) {
      if (!byId.has(d)) { add(e.id, `depends on unknown task ${d}`); continue; }
      if (pos.get(d) >= pos.get(e.id)) add(e.id, `depends on ${d}, which is not listed before it`);
      if (byId.get(d).slice > e.slice) add(e.id, `depends on ${d} in a later slice`);
    }
    if (e.acs.length === 0) add(e.id, 'cites no AC');
    if (e.files.length > 5) add(e.id, `touches ${e.files.length} files (limit 5)`);
    if (e.summary === null || e.summary === '') add(e.id, 'has no summary line');
    else if (e.summary.length > 500) add(e.id, 'summary is longer than 500 characters');
  }

  const rows = new Map(m.matrix.map((r) => [r.ac, r.tasks]));
  for (const e of m.index) for (const ac of e.acs) if (!(rows.get(ac) ?? []).includes(e.id)) add(e.id, `${ac} is not mapped to it in the coverage matrix`);
  for (const r of m.matrix) for (const t of r.tasks) if (!byId.has(t)) add('manifest', `coverage matrix maps ${r.ac} to unknown task ${t}`);
  if (spec !== null) {
    const known = specAcIds(spec);
    for (const ac of known) if ((rows.get(ac) ?? []).length === 0) add('manifest', `${ac} has no task in the coverage matrix`);
    for (const e of m.index) for (const ac of e.acs) if (!known.includes(ac)) add(e.id, `cites ${ac}, which is not in the spec`);
  }

  if (scope === 'outline') return defects;
  for (const t of plan.tasks.filter((x) => scope === 'plan' || x.slice === slice)) {
    if (!t.expanded) { add(t.id, 'not expanded (no task file)'); continue; }
    const p = t.parsed;
    const e = t.entry;
    if (p.id !== t.id) add(t.id, `file heading names ${p.id ?? 'no task'}`);
    if (p.title !== e.title) add(t.id, `title differs from the index (${p.title})`);
    if (!sameSet(p.satisfies, e.acs)) add(t.id, 'Satisfies differs from the index ACs');
    if (!sameSet(p.dependsOn, e.deps)) add(t.id, 'Depends on differs from the index');
    if (!sameSet(p.files, e.files)) add(t.id, 'Files differ from the index');
    if ((p.routerSummary ?? '') !== (e.summary ?? '')) add(t.id, 'Router summary differs from the index summary');
    if (!p.hasVerify) add(t.id, 'no Verify: line');
  }
  for (const o of plan.orphans) add(o.slice(0, -3), 'task file is not in the index');
  return defects;
}

const USAGE = 'usage: plan.mjs tasks <manifest> | plan.mjs check <manifest> [--outline | --slice <n> | --plan] [--spec <path>]';

export function run(argv, cwd = process.cwd()) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const [cmd, ...rest] = argv;
  const flags = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--outline' || a === '--plan') flags.scope = a.slice(2);
    else if (a === '--slice') { flags.scope = 'slice'; flags.slice = Number(rest[++i]); }
    else if (a === '--spec') flags.spec = rest[++i];
    else pos.push(a);
  }
  const bad = (cmd !== 'tasks' && cmd !== 'check') || pos.length !== 1
    || (flags.scope === 'slice' && !(Number.isInteger(flags.slice) && flags.slice > 0))
    || (cmd === 'tasks' && (flags.scope !== undefined || flags.spec !== undefined));
  if (bad) { err.push(USAGE); return done(2); }

  let plan;
  try { plan = loadPlan(resolve(cwd, pos[0])); } catch (e) { err.push(`plan.mjs: cannot read ${pos[0]}: ${e?.code ?? 'error'}`); return done(1); }
  if (cmd === 'tasks') { out.push(JSON.stringify(summarizePlan(plan, cwd))); return done(0); }

  const loaded = loadConfig(cwd);
  if (!loaded.ok) err.push(loaded.error);
  for (const w of loaded.warnings) err.push(w);
  let specText = null;
  if (flags.spec !== undefined) {
    try { specText = readFileSync(resolve(cwd, flags.spec), 'utf8'); } catch { err.push(`plan.mjs: cannot read spec ${flags.spec}`); return done(1); }
  }
  const defects = checkPlan(plan, { scope: flags.scope ?? 'plan', slice: flags.slice ?? null, spec: specText, sliceMax: loaded.config.limits.sliceMaxTasks });
  if (defects.length === 0) { out.push('ok'); return done(0); }
  out.push(...defects);
  return done(1);
}

if (basename(process.argv[1] ?? '') === 'plan.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
