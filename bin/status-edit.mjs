#!/usr/bin/env node
// SDD status edit: sets the `status:` value in a spec or plan frontmatter, and nothing else, then refreshes the Index.
// Usage: status-edit.mjs <file> <status>. Exit 0 on success (also when the status is already set), 1 when the file or
// its frontmatter cannot be edited, 2 on a malformed call. Node built-ins only.
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename } from 'node:path';
import { run as refreshIndex } from './index.mjs';

export const STATUSES = {
  spec: ['draft', 'in-review', 'approved'],
  plan: ['draft', 'in-review', 'approved', 'executing', 'done'],
};
const MAX_BLOCK_LINES = 30;

// Returns { text, from } with only the frontmatter `status:` line changed, or { error }.
export function setStatus(text, to) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const bom = lines[0].charCodeAt(0) === 0xfeff;
  if ((bom ? lines[0].slice(1) : lines[0]) !== '---') return { error: 'no frontmatter' };
  let type = null;
  let at = -1;
  let closed = false;
  for (let i = 1; i < MAX_BLOCK_LINES && i < lines.length; i++) {
    if (lines[i] === '---') { closed = true; break; }
    const t = /^type:\s*(\S+)\s*$/.exec(lines[i]);
    if (t) type = t[1];
    if (/^status:(?:\s|$)/.test(lines[i])) {
      if (at !== -1) return { error: 'more than one status line' };
      at = i;
    }
  }
  if (!closed) return { error: 'frontmatter is not closed' };
  if (!STATUSES[type]) return { error: `frontmatter type is ${type ?? 'missing'}, not spec or plan` };
  if (!STATUSES[type].includes(to)) return { error: `${to} is not a ${type} status (${STATUSES[type].join(', ')})` };
  if (at === -1) return { error: 'no status line' };
  const from = lines[at].slice('status:'.length).trim();
  if (from === to) return { text, from };
  lines[at] = `status: ${to}`;
  return { text: lines.join(nl), from };
}

function main(argv) {
  if (argv.length !== 2) { process.stderr.write('usage: status-edit.mjs <file> <status>\n'); return 2; }
  const [file, to] = argv;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { process.stderr.write(`status-edit: cannot read ${file}: ${e?.code ?? 'error'}\n`); return 1; }
  const r = setStatus(text, to);
  if (r.error) { process.stderr.write(`status-edit: ${file}: ${r.error}\n`); return 1; }
  if (r.text === text) { process.stdout.write(`status ${file}: already ${to}\n`); return 0; }
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, r.text); renameSync(tmp, file); } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to remove */ }
    process.stderr.write(`status-edit: cannot write ${file}: ${e?.code ?? 'error'}\n`);
    return 1;
  }
  process.stdout.write(`status ${file}: ${r.from} → ${to}\n`);
  const idx = refreshIndex(process.cwd());
  if (idx.code !== 0) process.stderr.write(idx.stderr);
  return 0;
}

if (basename(process.argv[1] ?? '') === 'status-edit.mjs') process.exitCode = main(process.argv.slice(2));
