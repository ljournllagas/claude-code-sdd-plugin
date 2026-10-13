#!/usr/bin/env node
// SDD status: summarises the active run and the decision log. Reads files only.
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { loadConfig, TIERS } from './route.mjs';
import { parsePlanTasks, loadPlan } from './plan.mjs';
import { validateOutcome } from './outcome.mjs';

// Re-exported: the plan parser lives in plan.mjs since v0.3, and callers still import it from here.
export { parsePlanTasks };

const pf = () => ({ pass: 0, fail: 0 });
// A router decision whose bump fired has a standalone "+1" in its reason (`→ +1 →`); no other reason has one.
const BUMP_FIRED = /(^|\s)\+1(\s|$)/;

function addOutcome(o, e) {
  o.total++;
  o.byResult[e.result]++;
  if (Number.isFinite(e.duration_ms)) { o.durationMs += e.duration_ms; o.durationCount++; }
  if (Number.isFinite(e.agent_tokens)) { o.agentTokens += e.agent_tokens; o.tokensCount++; }
  // `blocked` is not a pass or a fail, so it never enters a rate.
  if (!e.first_attempt || e.result === 'blocked') return;
  o.firstAttempt[e.result]++;
  o.firstAttemptByTier[e.tier][e.result]++;
  if (e.source === 'typesafe') o.bump[BUMP_FIRED.test(e.reason) ? 'fired' : 'notFired'][e.result]++;
}

export function summarizeLog(text) {
  const s = {
    total: 0, byTier: { light: 0, standard: 0, deep: 0 },
    bySource: { typesafe: 0, fallback: 0, escalation: 0, human: 0 },
    escalations: 0, fallbackShare: 0, inputTokens: 0, outputTokens: 0, skipped: 0,
    outcomes: {
      total: 0, byResult: { pass: 0, fail: 0, blocked: 0 }, firstAttempt: pf(),
      firstAttemptByTier: Object.fromEntries(TIERS.map((t) => [t, pf()])),
      bump: { fired: pf(), notFired: pf() },
      durationMs: 0, durationCount: 0, agentTokens: 0, tokensCount: 0,
    },
  };
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let entry;
    try { entry = JSON.parse(line); } catch { s.skipped++; continue; }
    if (entry !== null && typeof entry === 'object' && entry.kind === 'outcome') {
      if (validateOutcome(entry).length === 0) addOutcome(s.outcomes, entry); else s.skipped++;
      continue;
    }
    const d = entry?.decision;
    if (d === null || typeof d !== 'object') { s.skipped++; continue; }
    s.total++;
    if (d.tier in s.byTier) s.byTier[d.tier]++;
    if (d.source in s.bySource) s.bySource[d.source]++;
    if (entry.usage && Number.isFinite(entry.usage.input_tokens) && Number.isFinite(entry.usage.output_tokens)) {
      s.inputTokens += entry.usage.input_tokens;
      s.outputTokens += entry.usage.output_tokens;
    }
  }
  s.escalations = s.bySource.escalation;
  s.fallbackShare = s.total === 0 ? 0 : s.bySource.fallback / s.total;
  return s;
}

const n = (v) => v.toLocaleString('en-US');

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const ratio = ({ pass, fail }) => (pass + fail === 0 ? null : `${pass}/${pass + fail}`);
const pad2 = (v) => String(v).padStart(2, '0');

// Truncated, never rounded: `Xh YYm` from one hour up, `Xm YYs` below it.
export function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
}

function outcomeLines(o) {
  const out = [`Outcomes: ${plural(o.total, 'attempt')} · pass ${o.byResult.pass} · fail ${o.byResult.fail} · blocked ${o.byResult.blocked}`];
  const all = ratio(o.firstAttempt);
  if (all === null) out.push('  first attempt: n/a');
  else {
    const pct = Math.round((100 * o.firstAttempt.pass) / (o.firstAttempt.pass + o.firstAttempt.fail));
    const tiers = TIERS.filter((t) => ratio(o.firstAttemptByTier[t]) !== null).map((t) => `${t} ${ratio(o.firstAttemptByTier[t])}`);
    out.push(['  first attempt: ' + `${all} passed (${pct}%)`, ...tiers].join(' · '));
  }
  const side = (label, c) => (ratio(c) === null ? `${label}: n/a` : `${label}: ${ratio(c)} passed`);
  out.push(`  ${side('bump fired', o.bump.fired)} · ${side('no bump', o.bump.notFired)} (first attempt, TypeSafe)`);
  const cost = [];
  if (o.tokensCount > 0) cost.push(`agent tokens: ${n(o.agentTokens)} over ${plural(o.tokensCount, 'attempt')}`);
  if (o.durationCount > 0) cost.push(`duration: ${formatDuration(o.durationMs)} over ${plural(o.durationCount, 'attempt')}`);
  if (cost.length) out.push(`  ${cost.join(' · ')}`);
  return out;
}

// `expanded` is the number of tasks whose file exists, given only for a split plan.
export function formatStatus({ active, tasks, summary, expanded = null }) {
  const out = [];
  if (!active) out.push('No active run.');
  else {
    let line = `Active run: ${active.slug} · lane ${active.lane} · stage ${active.stage}`;
    if (active.slice && Number.isInteger(active.slice.n) && Number.isInteger(active.slice.total)) {
      line += ` · slice ${active.slice.n}/${active.slice.total}`;
    }
    if (active.lane === 'FULL') {
      line += tasks ? ` · task ${tasks.filter((t) => t.marker === 'x').length}/${tasks.length}` : ' · task ?/?';
      if (tasks && expanded !== null) line += ` (${expanded} expanded)`;
    }
    out.push(line);
  }
  if (summary.total === 0) out.push('No decisions logged yet.');
  else {
    out.push(`Decisions: ${summary.total} delegations`);
    out.push(`  by tier:   light ${summary.byTier.light} · standard ${summary.byTier.standard} · deep ${summary.byTier.deep}`);
    out.push(`  by source: typesafe ${summary.bySource.typesafe} · fallback ${summary.bySource.fallback} · escalation ${summary.bySource.escalation} · human ${summary.bySource.human}`);
    out.push(`  escalations: ${summary.escalations}`);
    out.push(`  fallback share: ${Math.round(summary.fallbackShare * 100)}%`);
    out.push(`  TypeSafe tokens: ${n(summary.inputTokens)} in / ${n(summary.outputTokens)} out`);
  }
  if (summary.outcomes && summary.outcomes.total > 0) out.push(...outcomeLines(summary.outcomes));
  if (summary.skipped > 0) out.push(`  (${summary.skipped} unreadable log line${summary.skipped === 1 ? '' : 's'} skipped)`);
  return out.join('\n') + '\n';
}

const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

function main() {
  const cwd = process.cwd();
  const loaded = loadConfig(cwd);
  if (!loaded.ok) { process.stderr.write(`${loaded.error}\n`); return 1; }
  const { paths } = loaded.config;
  let active = null;
  const markerText = readText(resolve(cwd, paths.active));
  if (markerText !== null) { try { active = JSON.parse(markerText); } catch { active = null; } }
  if (active === null || typeof active !== 'object' || Array.isArray(active)) active = null;
  let tasks = null;
  let expanded = null;
  if (active && typeof active.plan === 'string') {
    try {
      const plan = loadPlan(resolve(cwd, active.plan));
      tasks = plan.tasks.map(({ id, title, marker }) => ({ id, title, marker }));
      if (plan.layout === 'split') expanded = plan.tasks.filter((t) => t.expanded).length;
    } catch { tasks = null; }
  }
  const summary = summarizeLog(readText(resolve(cwd, paths.log)) ?? '');
  process.stdout.write(formatStatus({ active, tasks, summary, expanded }));
  return 0;
}

if (basename(process.argv[1] ?? '') === 'status.mjs') process.exitCode = main();
