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
    if (!isStr(r.endpoint) || !/^https?:\/\//.test(r.endpoint)) err('router.endpoint', 'must be an http(s) URL');
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
  }

  if (!isPlainObject(cfg.paths)) err('paths', 'must be an object');
  else for (const k of ['specs', 'plans', 'log', 'active']) if (!isStr(cfg.paths[k])) err(`paths.${k}`, 'must be a non-empty string');

  if (!isPlainObject(cfg.limits)) err('limits', 'must be an object');
  else for (const k of ['reviewRounds', 'verifyFailuresPerTier', 'reviewFixRounds', 'openQuestions', 'questionRounds']) {
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
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
    catch { return { ok: false, error: 'sdd.config.json: invalid JSON', config: def, warnings: [] }; }
    if (!isPlainObject(parsed)) return { ok: false, error: 'sdd.config.json: must be a JSON object', config: def, warnings: [] };
    merged = mergeConfig(def, parsed);
  }
  const { errors, warnings } = validateConfig(merged);
  if (errors.length) return { ok: false, error: `sdd.config.json: ${errors[0]}`, config: def, warnings };
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
// ==== DECISIONS ====
// ==== LOG AND CARD ====
// ==== ROUTE ====
// ==== CLI ====
