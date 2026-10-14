#!/usr/bin/env node
// SDD doctor: read-only health check of a run marker and its referenced artifacts.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { basename } from 'node:path';
import { loadConfig } from './route.mjs';
import { loadPlan } from './plan.mjs';

const STRINGS_STAGES = ['triage','spec-draft','spec-review','spec-approval','outline-draft','outline-review','outline-approval','plan-draft','plan-review','plan-approval','executing','code-review','review-fix','done','quick-dev','quick-review','quick-fix','quick-triage'];

export function collect(cwd = process.cwd()) {
  const lines = [];
  const issues = [];
  const add = (issue) => { issues.push(issue); };
  const cfg = loadConfig(cwd);
  if (!cfg.ok) add(`invalid config: ${cfg.error}`);
  lines.push('sdd doctor');
  lines.push(`project: ${cwd}`);
  if (cfg.warnings.length) for (const w of cfg.warnings) lines.push(`config warning: ${w}`);

  const activePath = join(cwd, '.sdd', 'active.json');
  if (!existsSync(activePath)) {
    lines.push('active run: none');
    return { lines, issues, exitCode: cfg.ok ? 0 : 1 };
  }
  let marker;
  try { marker = JSON.parse(readFileSync(activePath, 'utf8')); }
  catch (e) { add('active.json: invalid JSON'); lines.push('active run: unreadable marker'); return { lines, issues, exitCode: 1 }; }
  lines.push(`active run: ${marker?.slug ?? '(no slug)'}`);
  if (typeof marker !== 'object' || marker === null) { add('active.json: must be an object'); }
  for (const k of ['slug','lane','stage','spec','plan','started']) {
    if (marker?.[k] === undefined) add(`active.json: missing field ${k}`);
  }
  const stage = marker?.stage;
  if (stage !== undefined && !STRINGS_STAGES.includes(stage)) add(`active.json: unknown stage ${stage}`);
  if (marker?.updated) {
    const ageHours = (Date.now() - Date.parse(marker.updated)) / 3600000;
    const ttl = cfg.config?.guard?.ttlHours ?? 12;
    if (Number.isFinite(ageHours) && ageHours > ttl) add(`active run is stale: ${ageHours.toFixed(1)}h older than guard.ttlHours (${ttl}h)`);
  }
  lines.push(`  lane: ${marker?.lane ?? '-'}`);
  lines.push(`  stage: ${stage ?? '-'}`);
  lines.push(`  updated: ${marker?.updated ?? '-'}`);
  if (marker?.slice) lines.push(`  slice: ${marker.slice.n} of ${marker.slice.total}`);
  if (Array.isArray(marker?.approved_slices)) lines.push(`  approved slices: ${marker.approved_slices.join(', ') || 'none'}`);

  const specPath = marker?.spec ? join(cwd, marker.spec) : null;
  const planPath = marker?.plan ? join(cwd, marker.plan) : null;
  lines.push(`  spec: ${marker?.spec ?? '-'}`);
  if (specPath) lines.push(`    exists: ${existsSync(specPath)}`);
  if (specPath && !existsSync(specPath)) add(`spec file missing: ${marker.spec}`);
  lines.push(`  plan: ${marker?.plan ?? '-'}`);
  if (planPath) lines.push(`    exists: ${existsSync(planPath)}`);
  if (planPath && !existsSync(planPath)) add(`plan file missing: ${marker.plan}`);

  if (planPath && existsSync(planPath)) {
    try {
      const plan = loadPlan(planPath);
      const done = plan.tasks.filter((t) => t.marker === 'x').length;
      lines.push(`  plan tasks: ${done}/${plan.tasks.length} done, ${plan.tasks.filter((t) => !t.expanded).length} unexpanded, ${plan.orphans.length} orphan files`);
    } catch (e) {
      add(`plan cannot be parsed: ${e?.message ?? 'error'}`);
    }
  }

  const reviewDir = join(cwd, '.sdd', 'review');
  let reviewCount = 0;
  try { if (existsSync(reviewDir)) reviewCount = readdirSync(reviewDir).filter((f) => /\.md$/.test(f)).length; } catch {}
  lines.push(`  review records: ${reviewCount}`);

  let hint = 'Follow playbook section 1.6 resume rules for the recorded stage.';
  switch (stage) {
    case 'executing': hint = 'Resume execution (playbook section 7): run the next pending task of the current slice.'; break;
    case 'plan-draft': hint = 'Resume planning (playbook section 6 step 4): expand the first unexpanded task of the current slice.'; break;
    case 'plan-approval': hint = 'Ask the user to approve or request changes for the current plan/slice.'; break;
    case 'spec-approval': hint = 'Ask the user to approve or request changes for the spec.'; break;
    case 'code-review': hint = 'Run or resume the final code review (playbook section 8).'; break;
    case 'quick-dev': hint = 'Run or resume the QUICK attempt loop (playbook section 3).'; break;
  }
  lines.push(`  next: ${hint}`);

  if (Array.isArray(marker?.stop) === false && marker?.stop) lines.push(`  stop: ${JSON.stringify(marker.stop)}`);
  if (marker?.amendment) lines.push(`  amendment in flight: ${JSON.stringify(marker.amendment)}`);
  if (Array.isArray(marker?.kept) && marker.kept.length) lines.push(`  kept leftovers: ${marker.kept.length}`);

  return { lines, issues, exitCode: issues.length ? 1 : 0 };
}

export function run(argv = [], cwd = process.cwd()) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const report = collect(cwd);
  out.push(...report.lines);
  if (report.issues.length) {
    out.push('issues:');
    for (const i of report.issues) out.push(`  - ${i}`);
  } else {
    out.push('issues: none');
  }
  return done(report.exitCode);
}

if (basename(process.argv[1] ?? '') === 'doctor.mjs') {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
