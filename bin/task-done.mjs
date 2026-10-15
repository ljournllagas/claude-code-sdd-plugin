#!/usr/bin/env node
// SDD task-done: the success path of §7.3 step 7 in one command. Marks the task `[x] done`, stops on leftover
// edits outside its Files list (exit 3, nothing committed), commits only its Files, then writes the pass outcome.
// Safe to re-run after a "Leftover edits" stop: the marker edit is idempotent and nothing was committed yet.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { loadConfig, appendLog, isPlainObject } from './route.mjs';
import { loadPlan, TASK_RE } from './plan.mjs';
import { readMarker, writeMarker, git, isGitRepo, changedNonArtifacts, changedPaths, taskFiles } from './marker.mjs';
import { buildOutcome, validateOutcome } from './outcome.mjs';

const toSlash = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// Rewrites the heading line of task `id` in `file` to end in `[x] done`. Lines inside code fences are skipped.
export function markDone(file, id) {
  const text = readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    const m = !inFence && TASK_RE.exec(lines[i]);
    if (m && m[1] === id) {
      const next = lines[i].replace(/\[[ x!]\](?: (?:pending|done|blocked|skipped))?\s*$/, '[x] done');
      if (next !== lines[i]) { lines[i] = next; writeFileSync(file, lines.join(eol)); }
      return true;
    }
  }
  return false;
}

const USAGE = 'usage: task-done.mjs --manifest <plan> --task <T-id> [--duration-ms <n>] [--agent-tokens <n>] [--no-outcome]';

export function run(argv, cwd = process.cwd()) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-outcome') { f.noOutcome = true; continue; }
    if (!['--manifest', '--task', '--duration-ms', '--agent-tokens'].includes(argv[i]) || i + 1 >= argv.length) { err.push(USAGE); return done(2); }
    f[argv[i]] = argv[++i];
  }
  const id = f['--task'];
  if (!f['--manifest'] || !id) { err.push(USAGE); return done(2); }
  for (const k of ['--duration-ms', '--agent-tokens']) if (k in f && !/^\d+$/.test(f[k])) { err.push(`${k}: must be a non-negative integer`); return done(2); }

  const cfg = loadConfig(cwd).config;
  let plan;
  let marker;
  try {
    plan = loadPlan(resolve(cwd, f['--manifest']));
    marker = readMarker(cwd, cfg);
  } catch (e) { err.push(`task-done: ${e.message}`); return done(2); }
  if (!marker) { err.push(`task-done: no run marker at ${cfg.paths.active}`); return done(2); }
  const task = plan.tasks.find((t) => t.id === id);
  if (!task?.expanded) { err.push(`task-done: ${id} is not an expanded task of the plan`); return done(2); }

  // 1. The `[x] done` marker.
  if (!markDone(task.file, id)) { err.push(`task-done: no heading for ${id} in ${task.file}`); return done(2); }
  const files = taskFiles(plan, [id]);
  const summary = [`done ${id}`];

  if (isGitRepo(cwd)) {
    // 2. Leftover edits: changed paths outside this task's Files (minus dirty_at_start, kept and finished tasks' Files).
    const doneIds = loadPlan(resolve(cwd, f['--manifest'])).tasks.filter((t) => t.marker === 'x').map((t) => t.id);
    const skip = new Set([...(marker.dirty_at_start ?? []), ...(marker.kept ?? []), ...taskFiles(plan, doneIds), ...files].map(toSlash));
    const leftover = changedNonArtifacts(cwd, cfg).filter((p) => !skip.has(p));
    if (leftover.length) {
      out.push(...leftover.map((p) => `leftover: ${p}`));
      writeMarker(cwd, marker, cfg);
      return done(3);
    }
    // 3. Commit only the task's Files that exist and changed.
    const present = files.filter((p) => existsSync(resolve(cwd, p)));
    const missing = files.filter((p) => !present.includes(p));
    if (missing.length) summary.push(`not found: ${missing.join(', ')}`);
    const changed = present.length ? changedPaths(cwd, present) : [];
    if (changed.length === 0) summary.push('no commit: none of its files changed');
    else {
      const subject = task.parsed.commit || `${id}: ${task.title}`;
      const add = git(cwd, ['add', '--', ...present]);
      const commit = add.ok ? git(cwd, ['commit', '-q', '-m', subject, '--', ...present]) : add;
      if (!commit.ok) {
        out.push(`commit failed: ${(commit.err || commit.out).trim().split(/\r?\n/).slice(-5).join(' | ')}`);
        writeMarker(cwd, marker, cfg);
        return done(5);
      }
      summary.push(`commit ${git(cwd, ['rev-parse', '--short', 'HEAD']).out.trim()} ${subject}`);
    }
  } else summary.push('no commit (not a git repository)');

  // 4. The pass outcome line, from the marker entry (§7.3 Outcome line).
  const e = marker.tasks?.[id];
  if (!f.noOutcome && isPlainObject(e?.routed)) {
    const line = buildOutcome({
      slug: marker.slug, task: id, first_attempt: !e.last_tier, tier: e.attempt_tier, source: e.routed.source, reason: e.routed.reason,
      result: 'pass', duration_ms: f['--duration-ms'] ? Number(f['--duration-ms']) : null, agent_tokens: f['--agent-tokens'] ? Number(f['--agent-tokens']) : null,
    });
    const defects = validateOutcome(line);
    if (defects.length) err.push(`sdd outcome: warning: ${defects[0]}; no line written`);
    else appendLog(resolve(cwd, cfg.paths.log), line);
  }
  writeMarker(cwd, marker, cfg);
  out.push(summary.join(' · '));
  return done(0);
}

if (basename(process.argv[1] ?? '') === 'task-done.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
