#!/usr/bin/env node
// SDD guard (PreToolUse). While an SDD run is active, the main (team-lead) session may only edit run artifacts.
// Fails open on anything unexpected. No dependencies beyond Node built-ins.
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, basename } from 'node:path';

export const SUBAGENT_FIELD = 'agent_id'; // assumptions doc §1
export const DEFAULTS = { specs: 'docs/sdd/specs', plans: 'docs/sdd/plans', active: '.sdd/active.json', ttlHours: 12 };
const GUARDED = ['Edit', 'Write', 'NotebookEdit'];
const ALLOW = { deny: false };

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const readText = (p) => stripBom(readFileSync(p, 'utf8'));
const readJson = (p) => { try { return JSON.parse(readText(p)); } catch { return null; } };
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const str = (v, d) => (typeof v === 'string' && v.length > 0 ? v : d);

export function evaluate(input, now = Date.now(), env = process.env) {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return ALLOW;
    if (!GUARDED.includes(input.tool_name)) return ALLOW;
    if (input[SUBAGENT_FIELD]) return ALLOW;
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (typeof target !== 'string' || target.length === 0) return ALLOW;
    // The project root: the input cwd can follow the shell's working directory, CLAUDE_PROJECT_DIR does not.
    const cwd = str(env?.CLAUDE_PROJECT_DIR, str(input.cwd, process.cwd()));

    // Absent config → defaults. Present but unreadable, unparseable or not an object → fail open (spec AC-31).
    let cfg = {};
    try {
      cfg = JSON.parse(readText(resolve(cwd, 'sdd.config.json')));
    } catch (e) {
      if (e?.code !== 'ENOENT') return ALLOW;
    }
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return ALLOW;
    const paths = cfg.paths !== null && typeof cfg.paths === 'object' ? cfg.paths : {};
    const ttl = typeof cfg.guard?.ttlHours === 'number' && cfg.guard.ttlHours > 0 ? cfg.guard.ttlHours : DEFAULTS.ttlHours;

    const marker = readJson(resolve(cwd, str(paths.active, DEFAULTS.active)));
    if (marker === null || typeof marker !== 'object' || typeof marker.updated !== 'string') return ALLOW;
    const updated = Date.parse(marker.updated);
    if (Number.isNaN(updated) || now - updated >= ttl * 3600e3) return ALLOW;

    const rel = norm(relative(cwd, resolve(cwd, target)));
    const outside = rel === '..' || rel.startsWith('../') || isAbsolute(rel);
    const low = rel.toLowerCase();
    const dirs = ['.sdd', str(paths.specs, DEFAULTS.specs), str(paths.plans, DEFAULTS.plans)].map((d) => norm(d).toLowerCase());
    const allowed = !outside && (low === 'context.md' || low === 'sdd.config.json' || dirs.some((d) => low === d || low.startsWith(`${d}/`)));
    if (allowed) return ALLOW;
    const shown = outside ? norm(target) : rel;
    return {
      deny: true,
      message: `SDD guard: the team-lead session may not edit ${shown}. Delegate to the developer agent, or run "/sdd end" if no SDD run is active (marker .sdd/active.json expires after ${ttl}h of inactivity).`,
    };
  } catch {
    return ALLOW;
  }
}

async function main() {
  try {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    const result = evaluate(JSON.parse(text));
    if (result.deny) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.message },
      }));
    }
  } catch { /* fail open */ }
}

if (basename(process.argv[1] ?? '') === 'guard.mjs') main();
