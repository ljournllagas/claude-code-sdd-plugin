#!/usr/bin/env node
// SDD verify-waiver: out-of-band verification gate. When verify.external is true,
// a run either has a recorded waiver file, or an external verification command
// must succeed, before any verify set is treated as satisfied.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig } from './route.mjs';

export function collect(cwd = process.cwd()) {
  const cfg = loadConfig(cwd);
  const lines = [];
  const v = cfg.config?.verify ?? {};
  if (!v.external) {
    lines.push('verify.external is false: nothing to waive (run the configured verify set normally)');
    return { lines, exitCode: 0 };
  }
  const waiverFile = v.waiverFile || '.sdd/verify-waived.txt';
  const full = resolve(cwd, waiverFile);
  if (existsSync(full)) {
    lines.push(`external verification waived: ${waiverFile} exists`);
    return { lines, exitCode: 0 };
  }
  if (v.externalCommand) {
    try {
      execSync(v.externalCommand, { cwd, stdio: 'inherit' });
      lines.push(`external verification command succeeded: ${v.externalCommand}`);
      return { lines, exitCode: 0 };
    } catch (e) {
      lines.push(`external verification command failed: ${v.externalCommand}`);
      return { lines, exitCode: e?.status ?? 1 };
    }
  }
  lines.push('external verification is required but unsatisfied');
  lines.push(`create ${waiverFile} recording the human-run result, or set verify.externalCommand`);
  for (const k of ['build','test','lint','typecheck','format']) {
    if (v[k]) lines.push(`  configured ${k}: ${v[k]}`);
  }
  return { lines, exitCode: 1 };
}

export function run(argv = [], cwd = process.cwd()) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const r = collect(cwd);
  out.push(...r.lines);
  return done(r.exitCode);
}

if (basename(process.argv[1] ?? '') === 'verify-waiver.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
