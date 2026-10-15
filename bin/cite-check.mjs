#!/usr/bin/env node
// SDD cite-check: the spec's mechanical gate before review. Verifies the frontmatter block and that every
// file:line citation in its "## Background" section points at a file and line that exist. Read-only.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, basename } from 'node:path';
import { parseFrontmatter } from './index.mjs';

const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

// A citation is a repo-relative (or absolute) path with an extension, followed
// by a colon and a (possibly ranged) line number: Src/Foo.cs:42 or Foo.cs:10-12.
const CITATION_RE = /(?:^|[\s(,[;`"'<>])([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}):(\d+)(?:-(\d+))?/g;

export function extractBackground(text) {
  const lines = stripBom(String(text)).split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Background\s*$/.test(lines[i].trim())) { start = i + 1; break; }
  }
  if (start < 0) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

export function findCitations(text) {
  const found = new Map();
  let m;
  CITATION_RE.lastIndex = 0;
  while ((m = CITATION_RE.exec(text)) !== null) {
    const path = m[1].replace(/\\/g, '/');
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    const key = `${path}:${from}${m[3] ? `-${to}` : ''}`;
    if (!found.has(key)) found.set(key, { path, from, to });
  }
  return [...found.values()];
}

export function checkCitations(text, root = process.cwd()) {
  const defects = [];
  const bg = extractBackground(text);
  if (bg === null) {
    defects.push('spec: missing "## Background" section');
    return defects;
  }
  const cites = findCitations(bg);
  if (cites.length === 0) {
    const trimmed = bg.trim();
    if (trimmed && !/none identified/i.test(trimmed)) {
      defects.push('spec: Background has no file:line citations');
    }
    return defects;
  }
  for (const c of cites) {
    const full = resolve(root, c.path);
    let rel;
    try { rel = relative(root, full); } catch { rel = c.path; }
    if (!existsSync(full)) {
      defects.push(`spec: unresolved citation: ${c.path}:${c.from}${c.to !== c.from ? `-${c.to}` : ''} (file not found)`);
      continue;
    }
    const raw = readFileSync(full, 'utf8').split(/\r?\n/);
    const lineCount = raw.length > 1 && raw[raw.length - 1] === '' ? raw.length - 1 : raw.length;
    const lo = Math.min(c.from, c.to);
    const hi = Math.max(c.from, c.to);
    if (lo < 1 || hi > lineCount) {
      defects.push(`spec: citation line out of range: ${c.path}:${c.from}${c.to !== c.from ? `-${c.to}` : ''} (file has ${lineCount} lines)`);
    }
  }
  return defects;
}

// The reviewer no longer checks the block by hand: it opens and closes with `---`, every line is `key: value`,
// no key repeats, and type, title and status are present; type must be `spec`.
export function checkSpecFrontmatter(text) {
  const fm = parseFrontmatter(text);
  if (!fm.fields) return [`spec: invalid frontmatter (${fm.reason})`];
  if (fm.fields.type !== 'spec') return [`spec: frontmatter type is ${fm.fields.type}, not spec`];
  if (!fm.fields.description) return ['spec: frontmatter has no description'];
  return [];
}

export function run(argv, cwd = process.cwd()) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const [specArg] = argv;
  if (!specArg) { err.push('usage: cite-check.mjs <spec-path>'); return done(2); }
  let text;
  try { text = readFileSync(resolve(cwd, specArg), 'utf8'); }
  catch (e) { err.push(`cite-check: cannot read ${specArg}`); return done(2); }
  const defects = [...checkSpecFrontmatter(text), ...checkCitations(text, cwd)];
  if (defects.length === 0) { out.push('ok'); return done(0); }
  out.push(...defects);
  return done(1);
}

if (basename(process.argv[1] ?? '') === 'cite-check.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
