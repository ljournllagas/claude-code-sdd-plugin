#!/usr/bin/env node
// SDD detector: proposes Verify-block commands from manifests found in a repository.
// All toolchain knowledge lives in config/detectors.json; this file is generic.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const KEYS = ['build', 'test', 'lint', 'typecheck', 'format', 'testOne'];
const DEFAULT_DETECTORS = new URL('../config/detectors.json', import.meta.url);

const nameRegExp = (pattern) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
const lookup = (obj, dotted) => dotted.split('.').reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), obj);

function resolveCommand(spec, content) {
  if (spec === null || spec === undefined) return null;
  if (typeof spec === 'string') return spec;
  if ('ifJson' in spec) {
    try { return lookup(JSON.parse(content), spec.ifJson) !== undefined ? spec.cmd : null; } catch { return null; }
  }
  if ('ifMatch' in spec) return new RegExp(spec.ifMatch, spec.flags ?? '').test(content) ? spec.cmd : null;
  return spec.cmd ?? null;
}

const quoteDir = (d) => (/\s/.test(d) ? `"${d}"` : d);

function candidatesIn(dirAbs, dirRel, detectors) {
  let names;
  try { names = readdirSync(dirAbs, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); } catch { return []; }
  const out = [];
  for (const det of detectors) {
    for (const pattern of det.files) {
      const re = nameRegExp(pattern);
      for (const name of names.filter((n) => re.test(n))) {
        let content = '';
        try { content = readFileSync(join(dirAbs, name), 'utf8'); } catch { /* unreadable manifest: conditions fail */ }
        const verify = {};
        for (const k of KEYS) {
          let cmd = resolveCommand(det.verify[k], content);
          if (cmd && dirRel !== '.') cmd = `cd ${quoteDir(dirRel)} && ${cmd}`;
          verify[k] = cmd ?? null;
        }
        out.push({ source: dirRel === '.' ? name : `${dirRel}/${name}`, dir: dirRel, verify });
      }
    }
  }
  return out;
}

export function detect(root, detectorsPath = DEFAULT_DETECTORS) {
  const { skipDirs = [], detectors } = JSON.parse(readFileSync(detectorsPath, 'utf8'));
  const base = resolve(root);
  const candidates = candidatesIn(base, '.', detectors);
  const subdirs = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !skipDirs.includes(e.name))
    .map((e) => e.name)
    .sort();
  for (const d of subdirs) candidates.push(...candidatesIn(join(base, d), d, detectors));
  return { candidates };
}

if (basename(process.argv[1] ?? '') === 'detect.mjs') {
  process.stdout.write(JSON.stringify(detect(process.argv[2] ?? process.cwd())) + '\n');
}
