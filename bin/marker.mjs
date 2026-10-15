#!/usr/bin/env node
// SDD marker: reads and updates the run marker (.sdd/active.json) in one command, so the team-lead never
// rewrites the whole file by hand. Also the run's git facts (changed paths, run artifacts) shared by the Kit.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, isPlainObject } from './route.mjs';
import { loadPlan } from './plan.mjs';

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const toSlash = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

export class MarkerError extends Error {}

export function markerFile(cwd, cfg) {
  return resolve(cwd, cfg.paths.active);
}

export function readMarker(cwd, cfg = loadConfig(cwd).config) {
  const file = markerFile(cwd, cfg);
  if (!existsSync(file)) return null;
  let m;
  try { m = JSON.parse(stripBom(readFileSync(file, 'utf8'))); } catch { throw new MarkerError(`${cfg.paths.active}: invalid JSON`); }
  if (!isPlainObject(m)) throw new MarkerError(`${cfg.paths.active}: must be a JSON object`);
  return m;
}

export function writeMarker(cwd, marker, cfg = loadConfig(cwd).config, now = new Date()) {
  const file = markerFile(cwd, cfg);
  marker.updated = now.toISOString();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(marker, null, 2) + '\n');
  return marker;
}

// Dotted paths: `tasks.T3.in_progress`, `slice.n`. Intermediate objects are created on set.
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlainObject(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (isPlainObject(o) ? o[k] : undefined), obj);
}

export function delPath(obj, path) {
  const keys = path.split('.');
  const parent = keys.length === 1 ? obj : getPath(obj, keys.slice(0, -1).join('.'));
  if (isPlainObject(parent)) delete parent[keys[keys.length - 1]];
}

// A value is JSON when it parses as JSON (true, 3, null, {"n":1}); anything else is a plain string.
export function parseValue(v) {
  try { return JSON.parse(v); } catch { return v; }
}

export function newMarker(slug, lane, now = new Date()) {
  const ts = now.toISOString();
  return { slug, lane, stage: 'triage', base: null, dirty_at_start: null, spec: null, plan: null, started: ts, updated: ts, tasks: {} };
}

// One failed attempt (§7.3 step 8): counts against last_tier, which starts at the attempted tier.
export function countFailure(marker, key) {
  const e = marker.tasks?.[key];
  if (!isPlainObject(e)) throw new MarkerError(`tasks.${key}: no entry`);
  if (!e.last_tier) e.last_tier = e.attempt_tier;
  e.failures_at_last_tier = (e.failures_at_last_tier ?? 0) + 1;
  e.in_progress = false;
  return e;
}

// ==== GIT FACTS ====
export function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

export const isGitRepo = (cwd) => git(cwd, ['rev-parse', '--is-inside-work-tree']).ok;

// Paths `git status` shows changed, added, deleted or untracked, one per file (never a directory), relative to
// `cwd` (porcelain output is relative to the repository root, which may be above the project).
export function changedPaths(cwd, pathspec = []) {
  const r = git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all', ...(pathspec.length ? ['--', ...pathspec] : [])]);
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!r.ok || !top.ok) return [];
  const root = top.out.trim();
  const parts = r.out.split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    out.push(toSlash(relative(cwd, resolve(root, p.slice(3)))));
    if (p[0] === 'R' || p[0] === 'C') i++; // a rename or copy is followed by its source path
  }
  return out;
}

// Run artifacts are never "changed paths" (§12.4).
export function isRunArtifact(path, cfg) {
  const p = toSlash(path).toLowerCase();
  const under = (d) => { const x = toSlash(d).replace(/\/+$/, '').toLowerCase(); return p === x || p.startsWith(`${x}/`); };
  const index = toSlash(cfg.paths.index).toLowerCase();
  return under('.sdd') || p === 'context.md' || p === 'sdd.config.json' || under(cfg.paths.specs) || under(cfg.paths.plans)
    || p === index || (p.startsWith(`${index}.`) && p.endsWith('.tmp'));
}

export const changedNonArtifacts = (cwd, cfg) => changedPaths(cwd).filter((p) => !isRunArtifact(p, cfg));

// Files paths of the plan tasks selected by `ids` (all tasks when null).
export function taskFiles(plan, ids = null) {
  const pick = plan.tasks.filter((t) => ids === null || ids.includes(t.id));
  return [...new Set(pick.flatMap((t) => t.entry?.files ?? t.parsed?.files ?? []).map(toSlash))];
}

// ==== CLI ====
const USAGE = `usage: marker.mjs init <slug> <QUICK|FULL>
       marker.mjs set <key=value>...        (dotted keys; JSON values, else strings)
       marker.mjs del <key>...
       marker.mjs push <key> <value>...     (append to an array, no duplicates)
       marker.mjs fail <task key>           (count one failed attempt)
       marker.mjs baseline [--dirty] [--base]
       marker.mjs preflight <manifest> (--slice <n> | --tasks <T1,T2>)`;

export function run(argv, cwd = process.cwd()) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const [cmd, ...args] = argv;
  if (!['init', 'set', 'del', 'push', 'fail', 'baseline', 'preflight'].includes(cmd)) { err.push(USAGE); return done(2); }
  const loaded = loadConfig(cwd);
  const cfg = loaded.config;
  try {
    if (cmd === 'init') {
      const [slug, lane] = args;
      if (!slug || !['QUICK', 'FULL'].includes(lane)) { err.push(USAGE); return done(2); }
      writeMarker(cwd, newMarker(slug, lane), cfg);
      out.push('ok');
      return done(0);
    }
    if (cmd === 'preflight') {
      const i = args.indexOf('--slice');
      const j = args.indexOf('--tasks');
      if (!args[0] || (i < 0 && j < 0)) { err.push(USAGE); return done(2); }
      const plan = loadPlan(resolve(cwd, args[0]));
      const ids = j >= 0 ? args[j + 1].split(',').map((s) => s.trim()) : plan.tasks.filter((t) => t.slice === Number(args[i + 1])).map((t) => t.id);
      if (!isGitRepo(cwd)) { out.push('ok (not a git repository)'); return done(0); }
      const kept = new Set((readMarker(cwd, cfg)?.kept ?? []).map(toSlash));
      const files = new Set(taskFiles(plan, ids));
      const dirty = changedNonArtifacts(cwd, cfg).filter((p) => files.has(p) && !kept.has(p));
      if (dirty.length === 0) { out.push('ok'); return done(0); }
      out.push(...dirty.map((p) => `dirty: ${p}`));
      return done(1);
    }
    const m = readMarker(cwd, cfg);
    if (m === null) { err.push(`marker.mjs: no run marker at ${cfg.paths.active}`); return done(1); }
    if (cmd === 'set') {
      if (args.length === 0 || !args.every((a) => a.indexOf('=') > 0)) { err.push(USAGE); return done(2); }
      for (const a of args) { const k = a.indexOf('='); setPath(m, a.slice(0, k), parseValue(a.slice(k + 1))); }
    } else if (cmd === 'del') {
      if (args.length === 0) { err.push(USAGE); return done(2); }
      for (const k of args) delPath(m, k);
    } else if (cmd === 'push') {
      if (args.length < 2) { err.push(USAGE); return done(2); }
      const list = Array.isArray(getPath(m, args[0])) ? getPath(m, args[0]) : [];
      for (const v of args.slice(1).map(parseValue)) if (!list.includes(v)) list.push(v);
      setPath(m, args[0], list);
    } else if (cmd === 'fail') {
      if (!args[0]) { err.push(USAGE); return done(2); }
      const e = countFailure(m, args[0]);
      out.push(`${args[0]}: ${e.failures_at_last_tier} failure(s) at ${e.last_tier}`);
    } else if (cmd === 'baseline') {
      const both = !args.includes('--dirty') && !args.includes('--base');
      // Recorded when execution starts, so edits and commits made during spec and plan work stay out of the run.
      if (!['executing', 'quick-dev'].includes(m.stage)) { err.push(`marker.mjs: baseline is recorded at stage executing or quick-dev, not ${m.stage}`); return done(1); }
      if ((both || args.includes('--base')) && m.base !== null) { err.push(`marker.mjs: base is already recorded (${m.base}) and is never re-recorded`); return done(1); }
      const repo = isGitRepo(cwd);
      if (both || args.includes('--dirty')) m.dirty_at_start = repo ? changedNonArtifacts(cwd, cfg) : [];
      if (both || args.includes('--base')) {
        const h = repo ? git(cwd, ['rev-parse', 'HEAD']) : { ok: false };
        m.base = h.ok ? h.out.trim() : 'none';
      }
      out.push(`base: ${m.base ?? 'null'} · dirty_at_start: ${m.dirty_at_start === null ? 'null' : m.dirty_at_start.length}`);
    }
    writeMarker(cwd, m, cfg);
    if (out.length === 0) out.push('ok');
    return done(0);
  } catch (e) {
    err.push(`marker.mjs: ${e.message}`);
    return done(1);
  }
}

if (basename(process.argv[1] ?? '') === 'marker.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
