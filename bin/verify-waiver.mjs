#!/usr/bin/env node
// SDD verify-waiver: out-of-band verification gate. When verify.external is true,
// a run either has a recorded waiver file, or an external verification command
// must succeed, before any verify set is treated as satisfied.
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig } from './route.mjs';

// Where out-of-band verification stands, without running anything. verify.mjs and collect() both use it.
//   { state: 'off' } | { state: 'waived', waiverFile } | { state: 'command', command } | { state: 'missing', waiverFile }
export function externalState(verify, cwd = process.cwd()) {
  const v = verify ?? {};
  if (!v.external) return { state: 'off' };
  const waiverFile = v.waiverFile || '.sdd/verify-waived.txt';
  if (existsSync(resolve(cwd, waiverFile))) return { state: 'waived', waiverFile };
  if (v.externalCommand) return { state: 'command', command: v.externalCommand };
  return { state: 'missing', waiverFile };
}

export function collect(cwd = process.cwd()) {
  const v = loadConfig(cwd).config?.verify ?? {};
  const lines = [];
  const x = externalState(v, cwd);
  if (x.state === 'off') {
    lines.push('verify.external is false: nothing to waive (run the configured verify set normally)');
    return { lines, exitCode: 0 };
  }
  if (x.state === 'waived') {
    lines.push(`external verification waived: ${x.waiverFile} exists`);
    return { lines, exitCode: 0 };
  }
  if (x.state === 'command') {
    try {
      execSync(x.command, { cwd, stdio: 'inherit' });
      lines.push(`external verification command succeeded: ${x.command}`);
      return { lines, exitCode: 0 };
    } catch (e) {
      lines.push(`external verification command failed: ${x.command}`);
      return { lines, exitCode: e?.status ?? 1 };
    }
  }
  lines.push('external verification is required but unsatisfied');
  lines.push(`create ${x.waiverFile} recording the human-run result, or set verify.externalCommand`);
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
