// Builds throwaway projects for the run-state scripts (marker, card, task-done, verify).
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

export function mkProject(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sdd run '));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

export const sh = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

// A git repository with one commit holding every file present now.
export function gitInit(dir) {
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 'sdd@example.invalid');
  sh(dir, 'config', 'user.name', 'SDD test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

// A split plan with two tasks: T1 creates src/a.js, T2 modifies it (and depends on T1).
export const MANIFEST = [
  '---', 'type: plan', 'title: Demo', 'description: A demo plan.', 'status: executing', 'timestamp: 2026-10-15', 'layout: split', '---', '',
  '# Demo — Plan', '', '**Spec:** docs/sdd/specs/demo.md', '**Task count:** 2', '',
  '## Verify block', '', '- test: `node -e "process.exit(0)"`', '',
  '## Accepted risks', '', 'None', '',
  '## Coverage matrix', '', '| AC | Tasks |', '|---|---|', '| AC-1 | T1 |', '| AC-2 | T2 |', '',
  '## Slices', '', '- Slice 1 — Core', '',
  '## Task index', '',
  '- T1 — Add a · slice 1 · ACs: AC-1 · deps: none · files: `src/a.js`',
  '  summary: Add the a module.',
  '- T2 — Change a · slice 1 · ACs: AC-2 · deps: T1 · files: `src/a.js`, `src/b.js`',
  '  summary: Change the a module and add b.',
  '',
].join('\n');

export const task = (id, title, ac, deps, files, summary, verify = '`node -e "process.exit(0)"` → expected: passes') => [
  `### ${id} — ${title}   [ ] pending`,
  `Satisfies: ${ac}`,
  `Depends on: ${deps}`,
  'Lenses: none',
  `Router summary: ${summary}`,
  'Files:',
  ...files.map(([op, p]) => `  - ${op}  ${p}     (symbol: X)`),
  'Consumes:  none',
  'Produces:  X',
  'Reuse:     none — searched src/, nothing to reuse',
  'Tests (complete): none — no test command configured',
  'Recipe: 1. Do it.',
  `Verify: ${verify}`,
  `Commit: ${title.toLowerCase()}`,
  '',
].join('\n');

export function planFiles(verifyT1) {
  return {
    'docs/sdd/plans/demo.md': MANIFEST,
    'docs/sdd/plans/demo/T1.md': task('T1', 'Add a', 'AC-1', 'none', [['create', 'src/a.js']], 'Add the a module.', verifyT1),
    'docs/sdd/plans/demo/T2.md': task('T2', 'Change a', 'AC-2', 'T1', [['modify', 'src/a.js'], ['create', 'src/b.js']], 'Change the a module and add b.'),
  };
}
