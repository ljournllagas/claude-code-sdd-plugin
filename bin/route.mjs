#!/usr/bin/env node
// SDD router: turns a task card into a model-tier decision. See spec §5.
// Zero dependencies: Node built-ins only. Sections are filled in by Tasks 2-8.
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';


export const TIERS = ['light', 'standard', 'deep'];
export const STAGES = ['triage', 'analyst', 'planner', 'developer', 'reviewer-spec', 'reviewer-plan', 'reviewer-code'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const LENSES = ['security', 'data', 'contract', 'performance'];

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ==== CONFIG ====
export function defaultConfig() {
  return JSON.parse(readFileSync(new URL('../config/sdd.config.default.json', import.meta.url), 'utf8'));
}

// Objects merge key by key; anything else (arrays, scalars, null) from `over` replaces `base`.
export function mergeConfig(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? mergeConfig(base[k], v) : v;
  return out;
}

// The key is sent to the endpoint, so plain http is allowed only to this machine.
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
function isSafeEndpoint(v) {
  if (typeof v !== 'string') return false;
  let u;
  try { u = new URL(v); } catch { return false; }
  return u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.includes(u.hostname));
}

// A cloned repository's config chooses where the key goes and which variable is sent: say so when it differs.
export function routerWarnings(cfg) {
  const def = defaultConfig().router;
  const out = [];
  if (cfg.router.endpoint !== def.endpoint) out.push(`sdd.config.json: router.endpoint is not the default (${cfg.router.endpoint})`);
  if (cfg.router.apiKeyEnv !== def.apiKeyEnv) out.push(`sdd.config.json: router.apiKeyEnv is not the default (${cfg.router.apiKeyEnv}); that variable's value is sent as the bearer token`);
  return out;
}

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  const err = (field, msg) => errors.push(`${field}: ${msg}`);
  if (!isPlainObject(cfg)) return { errors: ['config: must be an object'], warnings };

  const isStr = (v) => typeof v === 'string' && v.length > 0;
  const isPosInt = (v) => Number.isInteger(v) && v > 0;
  const isUnit = (v) => typeof v === 'number' && v >= 0 && v <= 1;
  const isTier = (v) => TIERS.includes(v);

  for (const k of Object.keys(cfg)) {
    if (!(k in defaultConfig())) warnings.push(`unknown top-level key "${k}" ignored`);
  }
  if (cfg.version !== 1) err('version', 'must be 1');

  const tierKeyed = (name, obj, ok, desc) => {
    if (!isPlainObject(obj)) return err(name, 'must be an object');
    for (const t of TIERS) if (!(t in obj)) err(`${name}.${t}`, 'missing');
    for (const [k, v] of Object.entries(obj)) {
      if (!isTier(k)) err(`${name}.${k}`, 'unknown tier name');
      else if (!ok(v)) err(`${name}.${k}`, desc);
    }
  };
  tierKeyed('models', cfg.models, isStr, 'must be a non-empty string');
  tierKeyed('efforts', cfg.efforts, (v) => EFFORTS.includes(v), `must be one of ${EFFORTS.join(', ')}`);

  const stageKeyed = (name, obj) => {
    if (!isPlainObject(obj)) return err(name, 'must be an object');
    for (const s of STAGES) if (!(s in obj)) err(`${name}.${s}`, 'missing');
    for (const [k, v] of Object.entries(obj)) {
      if (!STAGES.includes(k)) err(`${name}.${k}`, 'unknown stage name');
      else if (!isTier(v)) err(`${name}.${k}`, 'must be a tier name (light, standard, deep)');
    }
  };
  stageKeyed('stageFloors', cfg.stageFloors);
  stageKeyed('fallbackTiers', cfg.fallbackTiers);

  const r = cfg.router;
  if (!isPlainObject(r)) err('router', 'must be an object');
  else {
    if (typeof r.enabled !== 'boolean') err('router.enabled', 'must be true or false');
    if (!isStr(r.apiKeyEnv)) err('router.apiKeyEnv', 'must be a non-empty string');
    if (!isStr(r.model)) err('router.model', 'must be a non-empty string');
    if (!isSafeEndpoint(r.endpoint)) err('router.endpoint', 'must be https (http only for localhost)');
    if (!isPosInt(r.timeoutMs)) err('router.timeoutMs', 'must be a positive integer');
    if (!isUnit(r.confidenceThreshold)) err('router.confidenceThreshold', 'must be a number in [0,1]');
    if (!isUnit(r.noulThreshold)) err('router.noulThreshold', 'must be a number in [0,1]');
    if (!isPosInt(r.maxSummaryChars)) err('router.maxSummaryChars', 'must be a positive integer');
  }

  if (!isPlainObject(cfg.riskPaths)) err('riskPaths', 'must be an object');
  else {
    for (const [cat, def] of Object.entries(cfg.riskPaths)) {
      if (!isPlainObject(def)) { err(`riskPaths.${cat}`, 'must be an object'); continue; }
      if (!Array.isArray(def.globs) || def.globs.length === 0 || !def.globs.every(isStr)) err(`riskPaths.${cat}.globs`, 'must be a non-empty array of strings');
      if (!isTier(def.minTier)) err(`riskPaths.${cat}.minTier`, 'must be a tier name (light, standard, deep)');
      if (!LENSES.includes(def.lens)) err(`riskPaths.${cat}.lens`, `must be one of ${LENSES.join(', ')}`);
    }
  }

  if (!Array.isArray(cfg.riskKeywords) || !cfg.riskKeywords.every((k) => typeof k === 'string')) err('riskKeywords', 'must be an array of strings');

  if (!isPlainObject(cfg.verify)) err('verify', 'must be an object');
  else {
    for (const k of ['build', 'test', 'lint', 'typecheck', 'format', 'testOne']) {
      const v = cfg.verify[k];
      if (!(v === null || typeof v === 'string')) err(`verify.${k}`, 'must be a string or null');
    }
    if (typeof cfg.verify.external !== 'boolean') err('verify.external', 'must be true or false');
    if (!(cfg.verify.waiverFile === null || typeof cfg.verify.waiverFile === 'string')) err('verify.waiverFile', 'must be a string or null');
    if (!(cfg.verify.externalCommand === null || typeof cfg.verify.externalCommand === 'string')) err('verify.externalCommand', 'must be a string or null');
  }

  if (!isPlainObject(cfg.paths)) err('paths', 'must be an object');
  else for (const k of ['specs', 'plans', 'log', 'active', 'index']) if (!isStr(cfg.paths[k])) err(`paths.${k}`, 'must be a non-empty string');

  if (!isPlainObject(cfg.limits)) err('limits', 'must be an object');
  else for (const k of ['reviewRounds', 'verifyFailuresPerTier', 'reviewFixRounds', 'openQuestions', 'questionRounds', 'sliceMaxTasks', 'expandBatchTasks']) {
    if (!isPosInt(cfg.limits[k])) err(`limits.${k}`, 'must be a positive integer');
  }

  if (!isPlainObject(cfg.guard)) err('guard', 'must be an object');
  else if (typeof cfg.guard.ttlHours !== 'number' || !(cfg.guard.ttlHours > 0)) err('guard.ttlHours', 'must be a positive number');

  return { errors, warnings };
}

export function loadConfig(projectDir) {
  const def = defaultConfig();
  const file = join(projectDir, 'sdd.config.json');
  let merged = def;
  if (existsSync(file)) {
    let parsed;
    try { parsed = JSON.parse(stripBom(readFileSync(file, 'utf8'))); }
    catch { return { ok: false, error: 'sdd.config.json: invalid JSON', config: def, warnings: [] }; }
    if (!isPlainObject(parsed)) return { ok: false, error: 'sdd.config.json: must be a JSON object', config: def, warnings: [] };
    merged = mergeConfig(def, parsed);
  }
  const v = validateConfig(merged);
  const warnings = v.warnings.map((w) => `sdd.config.json: ${w}`);
  if (v.errors.length) return { ok: false, error: `sdd.config.json: ${v.errors[0]}`, config: def, warnings };
  return { ok: true, config: merged, warnings };
}

// ==== RISK FLAGS ====
export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export function globToRegExp(glob) {
  const g = String(glob).toLowerCase();
  let re = '';
  for (let i = 0; i < g.length; ) {
    if (g.startsWith('**/', i)) { re += '(?:.*/)?'; i += 3; }
    else if (g.startsWith('**', i)) { re += '.*'; i += 2; }
    else if (g[i] === '*') { re += '[^/]*'; i += 1; }
    else if (g[i] === '?') { re += '[^/]'; i += 1; }
    else { re += g[i].replace(/[.+^${}()|[\]\\]/g, '\\$&'); i += 1; }
  }
  return new RegExp(`^${re}$`);
}

export function riskFlags(paths, riskPaths) {
  const norm = (Array.isArray(paths) ? paths : []).map(normalizePath);
  const flags = [];
  for (const [cat, def] of Object.entries(riskPaths)) {
    const res = def.globs.map(globToRegExp);
    if (norm.some((p) => res.some((r) => r.test(p)))) flags.push(cat);
  }
  return flags;
}
// ==== TYPESAFE WIRE ====
export class WireError extends Error {}

// Meanings are fixed by spec §5.2; wording is ours. Encoded for the wire by buildRequest.
export const QUESTIONS = [
  {
    id: 'kind', primitive: 'choice',
    prompt: 'What is the dominant nature of the work described in the state?',
    options: [
      { id: 'mechanical_edit', criteria: 'Renaming, moving, reformatting or other edits that do not change behaviour.' },
      { id: 'feature_logic', criteria: 'Adding or changing behaviour with clear requirements.' },
      { id: 'debugging', criteria: 'Finding and fixing the cause of wrong behaviour.' },
      { id: 'design_judgment', criteria: 'Choosing between approaches or shaping structure with trade-offs.' },
      { id: 'docs_or_text', criteria: 'Writing or editing documentation, comments or prose.' },
    ],
  },
  {
    id: 'complexity', primitive: 'score',
    prompt: 'How difficult is this work for an engineer who has not seen the codebase?',
    levels: [
      { index: 0, criteria: 'Trivial and mechanical.' },
      { index: 1, criteria: 'A contained, single-behaviour change.' },
      { index: 2, criteria: 'Multi-part or cross-cutting.' },
      { index: 3, criteria: 'Hard or ambiguous design.' },
    ],
  },
  {
    id: 'ambiguous', primitive: 'noul', prompt: 'Are the requirements unclear enough that a worker would have to guess at intent?',
    criteria: {
      true: 'Key details of the expected result are missing or open to more than one reasonable reading.',
      false: 'The expected result is clear enough to implement without guessing.',
    },
  },
  {
    id: 'irreversible', primitive: 'noul', prompt: 'Once deployed, can this change not be cleanly rolled back (schema, data, public contract, authentication, persisted data, deletion)?',
    criteria: {
      true: 'Rolling back would not restore the previous state cleanly.',
      false: 'Reverting the code change fully restores the previous state.',
    },
  },
  {
    id: 'cross_file', primitive: 'noul', prompt: 'Does the work need reasoning across several files or modules?',
    criteria: {
      true: 'The worker must understand and keep consistent several files or modules.',
      false: 'The work can be done by understanding a single file or module.',
    },
  },
];

export function truncateChars(s, n) {
  return Array.from(String(s ?? '')).slice(0, n).join('');
}

export function buildState(card, flags, maxChars) {
  const s = { stage: card.stage, summary: truncateChars(card.summary ?? '', maxChars), risk_flags: flags };
  for (const k of ['files_touched', 'tasks_upstream', 'tasks_downstream']) if (card[k] !== undefined) s[k] = card[k];
  return s;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Spec §5.2 "Scalar definitions". `raw` has the shape documented for extractRaw.
export function normalise(raw) {
  const bad = (m) => { throw new WireError(m); };
  if (!isPlainObject(raw)) bad('response is not an object');
  const prob = (v, name) => (isNum(v) && v >= 0 && v <= 1 ? v : bad(`${name} is not a probability`));
  const c = isPlainObject(raw.complexity) ? raw.complexity : bad('complexity answer missing');
  let confidence = isNum(c.confidence) ? c.confidence : null;
  let score;
  if (Array.isArray(c.levels) && c.levels.length === 4 && c.levels.every((p) => isNum(p) && p >= 0)) {
    const sum = c.levels.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) bad('complexity levels sum to zero');
    const p = c.levels.map((x) => x / sum);
    score = p.reduce((acc, x, i) => acc + i * x, 0);
    if (confidence === null) confidence = Math.max(...p);
  } else if (isNum(c.position) && isNum(c.scaleMax)) {
    const lo = isNum(c.scaleMin) ? c.scaleMin : 0;
    if (!(c.scaleMax > lo)) bad('complexity scale is empty');
    score = ((c.position - lo) / (c.scaleMax - lo)) * 3;
  } else bad('complexity answer unusable');
  if (confidence === null || confidence < 0 || confidence > 1) bad('complexity confidence missing');
  const u = raw.usage;
  const usage = isPlainObject(u) && isNum(u.input_tokens) && isNum(u.output_tokens)
    ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens } : null;
  return {
    kind: typeof raw.kind === 'string' ? raw.kind : null,
    complexityScore: Math.min(3, Math.max(0, score)),
    complexityConfidence: confidence,
    ambiguous: prob(raw.ambiguous, 'ambiguous'),
    irreversible: prob(raw.irreversible, 'irreversible'),
    cross_file: prob(raw.cross_file, 'cross_file'),
    usage,
  };
}

export function parseResponse(json) {
  return normalise(extractRaw(json));
}

// Encodes one QUESTIONS entry in the live wire format (assumptions §4) as an [id, question] pair for
// the `questions` map. The id is not shown to the model, so the meaning lives in instructions/criteria.
// For every question, the keys of the encoded value equal those of the same-type question in the fixture.
function encodeQuestion(q) {
  let criteria;
  if (q.primitive === 'choice') criteria = Object.fromEntries(q.options.map((o) => [o.id, o.criteria]));
  else if (q.primitive === 'score') criteria = [...q.levels].sort((a, b) => a.index - b.index).map((l) => l.criteria);
  else criteria = { true: q.criteria.true, false: q.criteria.false };
  return [q.id, { type: q.primitive, instructions: q.prompt, criteria }];
}

export function buildRequest(cfg, apiKey, state) {
  const body = { model: cfg.router.model, state, questions: Object.fromEntries(QUESTIONS.map(encodeQuestion)) };
  return {
    url: cfg.router.endpoint,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

// Reads the live response into the `raw` shape below. Returns null for any value the response does not
// carry; throws WireError (never TypeError) if `json` is not an object or the answers are structurally absent.
//   raw = { kind, complexity: { levels, position, scaleMin, scaleMax, confidence }, ambiguous, irreversible, cross_file, usage }
// Paths (assumptions §4): answers.kind.choice; answers.complexity.probabilities."0".."3" and .confidence;
// answers.<noul id>.noul; usage.input_tokens/output_tokens. The live Score answer carries per-level
// probabilities, so position/scaleMin/scaleMax are always null.
export function extractRaw(json) {
  if (!isPlainObject(json)) throw new WireError('response is not an object');
  const answers = json.answers;
  if (!isPlainObject(answers)) throw new WireError('response has no answers object');
  const ans = (id) => (isPlainObject(answers[id]) ? answers[id] : {});
  const num = (v) => (typeof v === 'number' ? v : null);
  const kind = ans('kind');
  const cxa = ans('complexity');
  const p = cxa.probabilities;
  const levels = isPlainObject(p) && Object.keys(p).length === 4 && [0, 1, 2, 3].every((i) => typeof p[String(i)] === 'number')
    ? [0, 1, 2, 3].map((i) => p[String(i)]) : null;
  const u = json.usage;
  const usage = isPlainObject(u) && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number'
    ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens } : null;
  return {
    kind: typeof kind.choice === 'string' ? kind.choice : null,
    complexity: { levels, position: null, scaleMin: null, scaleMax: null, confidence: num(cxa.confidence) },
    ambiguous: num(ans('ambiguous').noul),
    irreversible: num(ans('irreversible').noul),
    cross_file: num(ans('cross_file').noul),
    usage,
  };
}
// ==== DECISIONS ====
export const rank = (t) => TIERS.indexOf(t);
export const maxTier = (a, b) => (rank(b) > rank(a) ? b : a);
const fmt = (n) => String(Math.round(n * 100) / 100);

function applyRisk(tier, flags, cfg, parts) {
  for (const cat of flags) {
    const min = cfg.riskPaths[cat].minTier;
    if (rank(min) > rank(tier)) { tier = min; parts.push(`risk ${cat} → ${min}`); }
  }
  return tier;
}

const lensFor = (flags, cfg) => [...new Set(flags.map((c) => cfg.riskPaths[c].lens))];

function build(cfg, card, flags, tier, fields) {
  return {
    stage: card.stage, tier, effort: cfg.efforts[tier], model: cfg.models[tier],
    lane: null, lens: lensFor(flags, cfg), risk_flags: flags,
    source: 'typesafe', human: false, reason: '',
    ...fields,
  };
}

function laneFor(answers, flags, cfg) {
  const nt = cfg.router.noulThreshold;
  if (flags.length) return { lane: 'FULL', reason: `lane FULL: risk flag ${flags.join('+')}` };
  if (answers.irreversible >= nt) return { lane: 'FULL', reason: `lane FULL: irreversible ${fmt(answers.irreversible)} ≥ ${nt}` };
  if (answers.complexityScore >= 2) return { lane: 'FULL', reason: `lane FULL: complexity ${fmt(answers.complexityScore)} ≥ 2.0` };
  if (answers.ambiguous >= nt) return { lane: 'FULL', reason: `lane FULL: ambiguous ${fmt(answers.ambiguous)} ≥ ${nt}` };
  return { lane: 'QUICK', reason: 'lane QUICK: no risk flag, complexity < 2.0, requirements clear' };
}

// Spec §5.2 steps 1-8.
export function decideFromAnswers(card, answers, cfg, flags) {
  const r = cfg.router;
  const parts = [];
  let tier = answers.complexityScore < 1 ? 'light' : answers.complexityScore < 2 ? 'standard' : 'deep';
  parts.push(`complexity ${fmt(answers.complexityScore)} → ${tier}`);

  const why = [];
  if (answers.ambiguous >= r.noulThreshold) why.push(`ambiguous ${fmt(answers.ambiguous)}`);
  if (answers.irreversible >= r.noulThreshold) why.push(`irreversible ${fmt(answers.irreversible)}`);
  if (answers.complexityConfidence < r.confidenceThreshold) why.push(`confidence ${fmt(answers.complexityConfidence)} < ${r.confidenceThreshold}`);
  if (why.length) {
    tier = TIERS[Math.min(rank(tier) + 1, TIERS.length - 1)];
    parts.push(`${why.join(', ')} → +1 → ${tier}`);
  }
  if (answers.cross_file >= r.noulThreshold && rank(tier) < rank('standard')) {
    tier = 'standard';
    parts.push(`cross_file ${fmt(answers.cross_file)} → standard`);
  }
  const floor = cfg.stageFloors[card.stage];
  if (rank(floor) > rank(tier)) { tier = floor; parts.push(`floor ${card.stage}=${floor}`); }
  tier = applyRisk(tier, flags, cfg, parts);

  const d = build(cfg, card, flags, tier, { confidence: answers.complexityConfidence });
  if (card.stage === 'triage') {
    const l = laneFor(answers, flags, cfg);
    d.lane = l.lane;
    parts.push(l.reason);
  }
  d.reason = parts.join('; ');
  return d;
}

export const FALLBACK_CAUSES = ['no key', 'disabled', 'invalid config', 'timeout', 'network error', 'http 401', 'http 422', 'http 429', 'http 529', 'bad response'];

// Spec §5.4. `card.last_tier` is present.
export function escalate(card, cfg, flags) {
  const n = cfg.limits.verifyFailuresPerTier;
  const f = card.failures_at_last_tier ?? 0;
  const last = card.last_tier;
  const parts = [];
  let tier;
  let source = 'escalation';
  let human = false;
  if (f < n) { tier = last; parts.push(`retry at same tier (${f}/${n} failures at ${last})`); }
  else if (last !== 'deep') { tier = TIERS[rank(last) + 1]; parts.push(`${f} failures at ${last} → ${tier}`); }
  else { tier = 'deep'; source = 'human'; human = true; parts.push(`${f} failures at deep → human`); }
  const floor = cfg.stageFloors[card.stage];
  if (rank(floor) > rank(tier)) { tier = floor; parts.push(`floor ${card.stage}=${floor}`); }
  tier = applyRisk(tier, flags, cfg, parts);
  const d = build(cfg, card, flags, tier, { source, human });
  d.reason = parts.join('; ');
  return d;
}

// Spec §5.5. `cause` is one of FALLBACK_CAUSES or `http <status>`.
export function fallbackDecision(card, cfg, flags, cause) {
  const tier = applyRisk(cfg.fallbackTiers[card.stage], flags, cfg, []);
  const d = build(cfg, card, flags, tier, { source: 'fallback' });
  if (card.stage === 'triage') {
    const text = (card.summary ?? '').toLowerCase();
    const keyword = cfg.riskKeywords.some((k) => text.includes(k.toLowerCase()));
    const big = card.files_touched === undefined || card.files_touched > 2;
    d.lane = flags.length || keyword || big ? 'FULL' : 'QUICK';
  }
  d.reason = cause;
  return d;
}
// ==== LOG AND CARD ====
export class CardError extends Error {}

export function parseCard(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new CardError('card is not valid JSON'); }
  if (!isPlainObject(raw)) throw new CardError('card must be a JSON object');
  if (!STAGES.includes(raw.stage)) throw new CardError(`card.stage must be one of: ${STAGES.join(', ')}`);
  const card = { stage: raw.stage };
  const warnings = [];
  const warn = (f, why) => warnings.push(`card.${f}: ${why}; ignored`);
  const count = (v) => Number.isInteger(v) && v >= 0;
  if ('summary' in raw) { if (typeof raw.summary === 'string') card.summary = raw.summary; else warn('summary', 'must be a string'); }
  if ('paths' in raw) {
    if (Array.isArray(raw.paths) && raw.paths.every((p) => typeof p === 'string')) card.paths = raw.paths;
    else warn('paths', 'must be an array of strings');
  }
  for (const k of ['files_touched', 'tasks_upstream', 'tasks_downstream', 'failures_at_last_tier']) {
    if (k in raw) { if (count(raw[k])) card[k] = raw[k]; else warn(k, 'must be a non-negative integer'); }
  }
  if ('last_tier' in raw) { if (TIERS.includes(raw.last_tier)) card.last_tier = raw.last_tier; else warn('last_tier', 'must be light, standard or deep'); }
  return { card, warnings };
}

export function appendLog(logPath, entry) {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + '\n');
    return true;
  } catch (e) {
    process.stderr.write(`sdd route: could not write decision log: ${e.message}\n`);
    return false;
  }
}

export function logEntry(card, decision, usage, answers, now = new Date()) {
  const c = { stage: card.stage };
  for (const k of ['summary', 'files_touched', 'tasks_upstream', 'tasks_downstream', 'last_tier', 'failures_at_last_tier']) {
    if (card[k] !== undefined) c[k] = card[k];
  }
  return { ts: now.toISOString(), card: c, decision, usage: usage ?? null, answers: answers ?? null };
}
// ==== ROUTE ====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One attempt. Never throws.
async function attempt(fetchFn, url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal });
    if (!res.ok) return { ok: false, cause: `http ${res.status}`, retry: res.status === 429 || res.status === 529 };
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, cause: ctl.signal.aborted ? 'timeout' : 'network error', retry: true };
  } finally {
    clearTimeout(timer);
  }
}

// At most two attempts, 500 ms apart: total ≤ 2 × timeoutMs + 500 ms (AC-20). Never throws.
export async function callTypeSafe(cfg, apiKey, state, { fetchFn = fetch, sleepFn = sleep } = {}) {
  const { url, init } = buildRequest(cfg, apiKey, state);
  let last = { cause: 'network error' };
  for (let i = 0; i < 2; i++) {
    if (i > 0) await sleepFn(500);
    const a = await attempt(fetchFn, url, init, cfg.router.timeoutMs);
    if (a.ok) {
      try { return { ok: true, answers: parseResponse(JSON.parse(a.text)) }; }
      catch { return { ok: false, cause: 'bad response' }; }
    }
    last = a;
    if (!a.retry) break;
  }
  return { ok: false, cause: last.cause };
}

// Never throws: every runtime condition yields a valid decision (AC-15).
export async function route(card, { projectDir, env = process.env, fetchFn, sleepFn } = {}) {
  const loaded = loadConfig(projectDir);
  const cfg = loaded.config;
  const warnings = [...loaded.warnings, ...routerWarnings(cfg)];
  if (!loaded.ok) warnings.push(loaded.error);
  const c = card.summary === undefined ? card : { ...card, summary: truncateChars(card.summary, cfg.router.maxSummaryChars) };
  let flags = [];
  let decision;
  let usage = null;
  let answers = null;
  try {
    flags = riskFlags(c.paths, cfg.riskPaths);
    if (c.last_tier) decision = escalate(c, cfg, flags);
    else if (!loaded.ok) decision = fallbackDecision(c, cfg, flags, 'invalid config');
    else if (!cfg.router.enabled) decision = fallbackDecision(c, cfg, flags, 'disabled');
    else {
      const key = String(env[cfg.router.apiKeyEnv] ?? '').trim();
      if (!key) decision = fallbackDecision(c, cfg, flags, 'no key');
      else {
        const res = await callTypeSafe(cfg, key, buildState(c, flags, cfg.router.maxSummaryChars), { fetchFn, sleepFn });
        if (res.ok) {
          usage = res.answers.usage;
          answers = { kind: res.answers.kind, complexity: res.answers.complexityScore, ambiguous: res.answers.ambiguous, irreversible: res.answers.irreversible, cross_file: res.answers.cross_file };
          decision = decideFromAnswers(c, res.answers, cfg, flags);
        } else decision = fallbackDecision(c, cfg, flags, res.cause);
      }
    }
  } catch (e) {
    warnings.push(`internal error: ${e.message}`);
    decision = fallbackDecision(c, cfg, flags, 'bad response');
  }
  appendLog(resolve(projectDir, cfg.paths.log), logEntry(c, decision, usage, answers));
  return { decision, usage, answers, warnings };
}
// ==== CLI ====
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(argv) {
  const err = (m) => process.stderr.write(`${m}\n`);
  if (argv.includes('--check-config')) {
    const l = loadConfig(process.cwd());
    [...l.warnings, ...routerWarnings(l.config)].forEach((w) => err(`sdd route: warning: ${w}`));
    if (!l.ok) { err(l.error); return 1; }
    process.stdout.write('ok\n');
    return 0;
  }
  let text;
  try {
    const i = argv.indexOf('--card');
    text = i >= 0 ? readFileSync(argv[i + 1], 'utf8') : await readStdin();
  } catch (e) { err(`sdd route: cannot read card: ${e.message}`); return 2; }
  let parsed;
  try { parsed = parseCard(text); } catch (e) { err(`sdd route: ${e.message}`); return 2; }
  parsed.warnings.forEach((w) => err(`sdd route: warning: ${w}`));
  const out = await route(parsed.card, { projectDir: process.cwd() });
  out.warnings.forEach((w) => err(`sdd route: warning: ${w}`));
  process.stdout.write(JSON.stringify(out.decision) + '\n');
  return 0;
}

if (basename(process.argv[1] ?? '') === 'route.mjs') {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
