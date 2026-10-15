#!/usr/bin/env node
// SDD outcome: appends one outcome line (the result of one developer attempt) to the decision log.
// Never blocks a run: a runtime problem is one stderr warning and exit 0; only malformed flags exit 2.
import { resolve, basename } from 'node:path';
import { loadConfig, appendLog, TIERS, isPlainObject } from './route.mjs';
import { readMarker } from './marker.mjs';

export const RESULTS = ['pass', 'fail', 'blocked'];
export const SOURCES = ['typesafe', 'fallback', 'escalation'];
export const KEYS = ['ts', 'kind', 'stage', 'slug', 'task', 'first_attempt', 'tier', 'source', 'reason', 'result', 'duration_ms', 'agent_tokens'];

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isNonEmpty = (v) => typeof v === 'string' && v.length > 0;

// The one definition of a valid outcome line; status.mjs imports it. Returns a list of defects, empty when valid.
export function validateOutcome(o) {
  if (!isPlainObject(o)) return ['outcome: must be a JSON object'];
  const defects = [];
  for (const k of KEYS) if (!(k in o)) defects.push(`${k}: missing`);
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) defects.push(`${k}: unknown key`);
  const bad = (k, why) => { if (k in o) defects.push(`${k}: ${why}`); };
  if (typeof o.ts !== 'string' || !ISO_UTC.test(o.ts) || Number.isNaN(Date.parse(o.ts))) bad('ts', 'must be an ISO-8601 UTC timestamp');
  if (o.kind !== 'outcome') bad('kind', 'must be "outcome"');
  if (o.stage !== 'developer') bad('stage', 'must be "developer"');
  if (!isNonEmpty(o.slug)) bad('slug', 'must be a non-empty string');
  if (!isNonEmpty(o.task)) bad('task', 'must be a non-empty string');
  if (typeof o.first_attempt !== 'boolean') bad('first_attempt', 'must be true or false');
  if (!TIERS.includes(o.tier)) bad('tier', `must be one of ${TIERS.join(', ')}`);
  if (!SOURCES.includes(o.source)) bad('source', `must be one of ${SOURCES.join(', ')}`);
  if (typeof o.reason !== 'string') bad('reason', 'must be a string');
  if (!RESULTS.includes(o.result)) bad('result', `must be one of ${RESULTS.join(', ')}`);
  if (!(o.duration_ms === null || isNonNegInt(o.duration_ms))) bad('duration_ms', 'must be a non-negative integer or null');
  if (!(o.agent_tokens === null || isNonNegInt(o.agent_tokens))) bad('agent_tokens', 'must be a non-negative integer or null');
  return defects;
}

class UsageError extends Error {}

const FLAGS = {
  '--slug': 'slug', '--task': 'task', '--first-attempt': 'first_attempt', '--tier': 'tier', '--source': 'source',
  '--reason': 'reason', '--result': 'result', '--duration-ms': 'duration_ms', '--agent-tokens': 'agent_tokens',
};
const REQUIRED = ['--slug', '--task', '--first-attempt', '--tier', '--source', '--reason', '--result'];

function parseArgs(argv) {
  const seen = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!(flag in FLAGS)) throw new UsageError(`${flag}: unknown flag`);
    if (flag in seen) throw new UsageError(`${flag}: given twice`);
    if (i + 1 >= argv.length) throw new UsageError(`${flag}: needs a value`);
    seen[flag] = argv[i + 1];
  }
  for (const f of REQUIRED) if (!(f in seen)) throw new UsageError(`${f}: required`);
  const intOrNull = (flag) => {
    if (!(flag in seen)) return null;
    if (!/^\d+$/.test(seen[flag])) throw new UsageError(`${flag}: must be a non-negative integer`);
    return Number(seen[flag]);
  };
  if (seen['--first-attempt'] !== 'true' && seen['--first-attempt'] !== 'false') throw new UsageError('--first-attempt: must be true or false');
  return {
    slug: seen['--slug'], task: seen['--task'], first_attempt: seen['--first-attempt'] === 'true', tier: seen['--tier'],
    source: seen['--source'], reason: seen['--reason'], result: seen['--result'],
    duration_ms: intOrNull('--duration-ms'), agent_tokens: intOrNull('--agent-tokens'),
  };
}

export function buildOutcome(fields, now = new Date()) {
  return { ts: now.toISOString(), kind: 'outcome', stage: 'developer', ...fields };
}

// `--from-marker` fills --slug, --first-attempt, --tier, --source and --reason from the marker's entry for --task
// (§7.3 Outcome line), so they are never copied by hand. Flags given explicitly win. Returns null: write no line.
export function fromMarker(argv, cwd) {
  const rest = argv.filter((a) => a !== '--from-marker');
  const i = rest.indexOf('--task');
  if (i < 0 || i + 1 >= rest.length) throw new UsageError('--task: required');
  let m;
  try { m = readMarker(cwd); } catch (e) { throw new UsageError(`--from-marker: ${e.message}`); }
  const e = m?.tasks?.[rest[i + 1]];
  if (!isPlainObject(e) || !isPlainObject(e.routed)) return null;
  const fill = { '--slug': m.slug, '--first-attempt': String(!e.last_tier), '--tier': e.attempt_tier, '--source': e.routed.source, '--reason': e.routed.reason };
  for (const [f, v] of Object.entries(fill)) if (!rest.includes(f)) rest.push(f, String(v ?? ''));
  return rest;
}

export function main(argv, cwd = process.cwd()) {
  const err = (m) => process.stderr.write(`${m}\n`);
  let line;
  try {
    if (argv.includes('--from-marker')) {
      argv = fromMarker(argv, cwd);
      if (argv === null) { err('sdd outcome: warning: the marker entry has no routed decision; no line written'); return 0; }
    }
    line = buildOutcome(parseArgs(argv));
    const defects = validateOutcome(line);
    if (defects.length) {
      // Name the flag the caller typed, not the line key (first_attempt → --first-attempt).
      const [key, ...rest] = defects[0].split(': ');
      const flag = Object.keys(FLAGS).find((f) => FLAGS[f] === key) ?? key;
      throw new UsageError([flag, ...rest].join(': '));
    }
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`sdd outcome: ${e.message}`);
    return 2;
  }
  const loaded = loadConfig(cwd);
  if (!loaded.ok) err(`sdd outcome: warning: ${loaded.error}; using the default log path`);
  appendLog(resolve(cwd, loaded.config.paths.log), line);
  return 0;
}

if (basename(process.argv[1] ?? '') === 'outcome.mjs') process.exitCode = main(process.argv.slice(2));
