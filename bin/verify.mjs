#!/usr/bin/env node
// SDD verify: runs a verify set and prints one line, so test output never floods the caller's context.
// On failure the last 40 lines of combined output go to the task's failure file (or to stdout without one).
import { openSync, closeSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './route.mjs';
import { loadPlan } from './plan.mjs';
import { readMarker } from './marker.mjs';
import { externalState } from './verify-waiver.mjs';

export const TAIL_LINES = 40;
const QUICK_KEYS = ['build', 'test', 'lint', 'typecheck']; // never format (§3 step 2)

// The commands of a task's `Verify:` line: its backticked spans before "→", else the text before "→".
// Returns null for a `Verify: Manual: …` line.
export function verifyCommands(value) {
  const v = String(value ?? '').trim();
  if (/^manual:/i.test(v)) return null;
  const head = v.split(/\s+(?:→|->)\s+/)[0];
  const ticked = [...head.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
  if (ticked.length) return ticked;
  return head.trim() ? [head.trim()] : [];
}

export const quickCommands = (verify) => QUICK_KEYS.map((k) => verify?.[k]).filter((c) => typeof c === 'string' && c.trim());

export function tail(text, n = TAIL_LINES) {
  const lines = String(text).replace(/\s+$/, '').split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

const shell = process.platform === 'win32' ? true : (existsSync('/bin/bash') ? '/bin/bash' : true);

// Runs one command from `cwd` with stdout and stderr into one file, so their order is kept. Never throws.
// A command still running after `timeoutMs` (a watch mode, a prompt) is killed and fails, so no caller hangs.
export function runCommand(command, cwd, timeoutMs = 30 * 60e3) {
  const dir = mkdtempSync(join(tmpdir(), 'sdd-verify-'));
  const file = join(dir, 'out.txt');
  const fd = openSync(file, 'w');
  let r;
  try { r = spawnSync(command, { cwd, shell, stdio: ['ignore', fd, fd], timeout: timeoutMs }); } finally { closeSync(fd); }
  const output = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  const code = r.status ?? 1;
  const why = r.error?.code === 'ETIMEDOUT' ? `timed out after ${Math.round(timeoutMs / 1000)} s` : r.error?.message;
  return { ok: !r.error && code === 0, code, output: why ? `${output}\n${why}` : output };
}

const USAGE = 'usage: verify.mjs [--key <task key>] (--cmd "<command>"... | --manifest <plan> --task <T-id> | --quick)';

export function run(argv, cwd = process.cwd(), exec = runCommand) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const flags = { cmd: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') flags.quick = true;
    else if (['--cmd', '--key', '--manifest', '--task'].includes(a) && i + 1 < argv.length) {
      if (a === '--cmd') flags.cmd.push(argv[++i]); else flags[a.slice(2)] = argv[++i];
    } else { err.push(USAGE); return done(2); }
  }
  const sources = [flags.cmd.length > 0, flags.manifest !== undefined, flags.quick === true].filter(Boolean).length;
  if (sources !== 1 || (flags.manifest !== undefined) !== (flags.task !== undefined)) { err.push(USAGE); return done(2); }

  const cfg = loadConfig(cwd).config;
  let commands = flags.cmd;
  if (flags.quick) commands = quickCommands(cfg.verify);
  if (flags.manifest) {
    let task;
    try { task = loadPlan(resolve(cwd, flags.manifest)).tasks.find((t) => t.id === flags.task); } catch (e) { err.push(`verify.mjs: cannot read ${flags.manifest}: ${e.code ?? e.message}`); return done(2); }
    if (!task?.parsed?.hasVerify) { err.push(`verify.mjs: ${flags.task} has no Verify: line`); return done(2); }
    commands = verifyCommands(task.parsed.verify);
    if (commands === null) { out.push(`manual: ${task.parsed.verify.replace(/^manual:\s*/i, '')}`); return done(4); }
  }

  let failFile = null;
  if (flags.key) {
    const slug = readMarker(cwd, cfg)?.slug;
    if (!slug) { err.push('verify.mjs: --key needs a run marker with a slug'); return done(2); }
    failFile = resolve(cwd, '.sdd', 'review', `${slug}-${flags.key}.fail.txt`);
  }
  const fail = (what, output) => {
    if (failFile) {
      mkdirSync(dirname(failFile), { recursive: true });
      writeFileSync(failFile, tail(output) + '\n');
      out.push(`fail: ${what}; last ${TAIL_LINES} lines in ${relative(cwd, failFile).replace(/\\/g, '/')}`);
    } else {
      out.push(`fail: ${what}`, tail(output));
    }
    return done(1);
  };

  // Plain --cmd with no --key is the developer's runner: out-of-band verification is the team-lead's gate, not its.
  const ext = flags.cmd.length > 0 && !flags.key ? { state: 'off' } : externalState(cfg.verify, cwd);
  if (commands.length === 0 && ext.state === 'off') { out.push('empty: no verify command is configured'); return done(3); }
  const timeoutMs = cfg.verify.timeoutMinutes * 60e3;
  for (const c of commands) {
    const r = exec(c, cwd, timeoutMs);
    if (!r.ok) return fail(`${c} (exit ${r.code})`, r.output);
  }
  let note = '';
  if (ext.state === 'waived') note = ` · external: waived (${ext.waiverFile})`;
  else if (ext.state === 'missing') return fail('external verification is required', `verify.external is true: create ${ext.waiverFile} recording the human-run result, or set verify.externalCommand`);
  else if (ext.state === 'command') {
    const r = exec(ext.command, cwd, timeoutMs);
    if (!r.ok) return fail(`external: ${ext.command} (exit ${r.code})`, r.output);
    note = ' · external: passed';
  }
  out.push(`pass: ${commands.length} command(s)${note}`);
  return done(0);
}

if (basename(process.argv[1] ?? '') === 'verify.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
