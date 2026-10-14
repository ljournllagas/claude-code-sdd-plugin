#!/usr/bin/env node
// SDD scope-check: counts acceptance criteria in a spec and rejects ones that
// exceed the configured size limit, so oversized stories are split before review.
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { loadConfig } from './route.mjs';

export function countAcceptanceCriteria(text) {
  const ids = new Set();
  for (const m of String(text).matchAll(/\bAC[-_]?(\d+[a-z]?)\b/gi)) {
    ids.add(m[0].toUpperCase().replace(/[-_]/g, '-'));
  }
  return ids.size;
}

export function checkScope(text, cwd = process.cwd()) {
  const cfg = loadConfig(cwd);
  const limit = cfg.config?.limits?.maxAcceptanceCriteria ?? 20;
  const count = countAcceptanceCriteria(text);
  if (count > limit) {
    return [`spec: ${count} acceptance criteria (limit ${limit}); split the request before review (playbook section 2)`];
  }
  return [];
}

export function run(argv, cwd = process.cwd()) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const [specArg] = argv;
  if (!specArg) { err.push('usage: scope-check.mjs <spec-path>'); return done(2); }
  let text;
  try { text = readFileSync(resolve(cwd, specArg), 'utf8'); }
  catch (e) { err.push(`scope-check: cannot read ${specArg}`); return done(2); }
  const defects = checkScope(text, cwd);
  if (defects.length === 0) { out.push('ok'); return done(0); }
  out.push(...defects);
  return done(1);
}

if (basename(process.argv[1] ?? '') === 'scope-check.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
