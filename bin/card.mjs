#!/usr/bin/env node
// SDD card: builds a routing card from the plan (or from flags), routes it, and with --record writes the
// attempt entry to the marker (§7.3 step 2). One command instead of writing .sdd/card.json by hand.
import { resolve, basename } from 'node:path';
import { loadConfig, route, parseCard, rank, STAGES, TIERS, isPlainObject } from './route.mjs';
import { loadPlan } from './plan.mjs';
import { readMarker, writeMarker } from './marker.mjs';

const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const uniq = (a) => [...new Set(a)];

const filesOf = (t) => t.entry?.files ?? t.parsed?.files ?? [];
const depsOf = (t) => t.entry?.deps ?? t.parsed?.dependsOn ?? [];
const summaryOf = (t) => t.entry?.summary ?? t.parsed?.routerSummary ?? t.title ?? '';

// Card fields by stage (§12.1) from a loaded plan.
export function planCard(stage, plan, { task, tasks, slice } = {}) {
  const goal = plan.manifest.fields?.title ?? basename(plan.manifestPath, '.md');
  if (stage === 'developer') {
    const t = plan.tasks.find((x) => x.id === task);
    if (!t) throw new Error(`task ${task} is not in the plan`);
    const files = filesOf(t);
    return {
      stage, summary: summaryOf(t), paths: files, files_touched: files.length,
      tasks_upstream: depsOf(t).length, tasks_downstream: plan.tasks.filter((x) => depsOf(x).includes(t.id)).length,
    };
  }
  if (stage === 'planner') {
    const batch = plan.tasks.filter((x) => tasks.includes(x.id));
    const paths = uniq(batch.flatMap(filesOf));
    return { stage, summary: `Write the task files for: ${batch.map(summaryOf).join(' ')}`, paths, files_touched: paths.length };
  }
  if (stage === 'reviewer-plan') {
    const scope = slice ? plan.tasks.filter((x) => x.slice === slice) : plan.tasks;
    const paths = uniq(scope.flatMap(filesOf));
    return { stage, summary: `Review the plan for: ${goal}`, paths, files_touched: paths.length };
  }
  throw new Error(`stage ${stage} takes --summary, not a plan`);
}

// §7.3 step 2 and the tier reset of step 8: the entry that dispatches this attempt.
export function recordAttempt(marker, key, decision) {
  if (!isPlainObject(marker.tasks)) marker.tasks = {};
  const e = isPlainObject(marker.tasks[key]) ? marker.tasks[key] : {};
  if (e.last_tier && rank(decision.tier) > rank(e.last_tier)) { e.last_tier = decision.tier; e.failures_at_last_tier = 0; }
  e.attempt_tier = decision.tier;
  e.in_progress = true;
  e.routed = { source: decision.source, reason: decision.reason };
  marker.tasks[key] = e;
  return e;
}

const USAGE = `usage: card.mjs --stage <stage> [--manifest <plan> (--task <T-id> | --tasks <T1,T2> | --slice <n>)]
                [--summary "<plain text>"] [--paths <a,b>] [--files-touched <n>]
                [--retry <key> | --resume <key> | --last-tier <tier> --failures <n>] [--record <key>]`;

const VALUE_FLAGS = ['--stage', '--manifest', '--task', '--tasks', '--slice', '--summary', '--paths', '--files-touched', '--retry', '--resume', '--last-tier', '--failures', '--record'];

export async function run(argv, cwd = process.cwd(), opts = {}) {
  const out = [];
  const err = [];
  const done = (code) => ({ code, stdout: out.map((l) => `${l}\n`).join(''), stderr: err.map((l) => `${l}\n`).join('') });
  const f = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!VALUE_FLAGS.includes(argv[i]) || i + 1 >= argv.length || argv[i] in f) { err.push(USAGE); return done(2); }
    f[argv[i]] = argv[i + 1];
  }
  const stage = f['--stage'];
  if (!STAGES.includes(stage)) { err.push(USAGE); return done(2); }
  const cfg = loadConfig(cwd).config;

  let card;
  try {
    if (f['--manifest']) {
      const plan = loadPlan(resolve(cwd, f['--manifest']));
      card = planCard(stage, plan, { task: f['--task'], tasks: list(f['--tasks']), slice: f['--slice'] ? Number(f['--slice']) : null });
    } else {
      card = { stage };
      if (f['--summary'] !== undefined) card.summary = f['--summary'];
      if (f['--paths'] !== undefined) card.paths = list(f['--paths']);
      if (f['--files-touched'] !== undefined) card.files_touched = Number(f['--files-touched']);
    }
    const marker = f['--retry'] || f['--resume'] || f['--record'] ? readMarker(cwd, cfg) : null;
    if (f['--retry'] || f['--resume']) {
      const key = f['--retry'] ?? f['--resume'];
      const e = marker?.tasks?.[key];
      if (!isPlainObject(e)) throw new Error(`no marker entry for ${key}`);
      if (f['--retry']) {
        if (!e.last_tier) throw new Error(`${key} has no failed attempt to retry (no last_tier)`);
        card.last_tier = e.last_tier;
        card.failures_at_last_tier = e.failures_at_last_tier ?? 0;
      } else {
        card.last_tier = e.attempt_tier;
        card.failures_at_last_tier = e.failures_at_last_tier ?? 0;
      }
    } else if (f['--last-tier'] !== undefined) {
      if (!TIERS.includes(f['--last-tier'])) throw new Error('--last-tier must be light, standard or deep');
      card.last_tier = f['--last-tier'];
      card.failures_at_last_tier = Number(f['--failures'] ?? 0);
    }
    const parsed = parseCard(JSON.stringify(card));
    parsed.warnings.forEach((w) => err.push(`sdd route: warning: ${w}`));
    const res = await route(parsed.card, { projectDir: cwd, ...opts });
    res.warnings.forEach((w) => err.push(`sdd route: warning: ${w}`));
    if (f['--record'] && !res.decision.human) {
      if (!marker) throw new Error(`--record needs a run marker at ${cfg.paths.active}`);
      recordAttempt(marker, f['--record'], res.decision);
      writeMarker(cwd, marker, cfg);
    }
    out.push(JSON.stringify(res.decision));
    return done(0);
  } catch (e) {
    err.push(`sdd card: ${e.message}`);
    return done(2);
  }
}

if (basename(process.argv[1] ?? '') === 'card.mjs') {
  run(process.argv.slice(2)).then((r) => {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.code;
  });
}
