import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect } from '../bin/detect.mjs';

const DETECT = fileURLToPath(new URL('../bin/detect.mjs', import.meta.url));
const KEYS = ['build', 'test', 'lint', 'typecheck', 'format', 'testOne'];
const cases = JSON.parse(readFileSync(new URL('./fixtures/detect-cases.json', import.meta.url), 'utf8'));

const mkRepo = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'sdd detect '));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
};

for (const c of cases) {
  test(`detects ${c.name}`, () => {
    const { candidates } = detect(mkRepo(c.files));
    assert.equal(candidates.length, 1, JSON.stringify(candidates));
    const cand = candidates[0];
    assert.equal(cand.source, c.source);
    assert.equal(cand.dir, '.');
    assert.deepEqual(Object.keys(cand.verify), KEYS);
    for (const [k, v] of Object.entries(c.expect)) assert.equal(cand.verify[k], v, k);
  });
}

test('empty repository has no candidates', () => {
  assert.deepEqual(detect(mkRepo({ 'README.md': 'x' })), { candidates: [] });
});

test('subdirectories: prefixed commands, quoting for spaces, skip list and hidden dirs', () => {
  const root = mkRepo({
    'package.json': '{"scripts":{"test":"t"}}',
    'api/go.mod': 'module x\n',
    'my svc/go.mod': 'module y\n',
    'node_modules/dep/package.json': '{"scripts":{"test":"t"}}',
    'node_modules/package.json': '{"scripts":{"test":"t"}}',
    '.hidden/go.mod': 'module z\n',
    'api/deep/go.mod': 'module deep\n',
  });
  const { candidates } = detect(root);
  assert.deepEqual(candidates.map((c) => c.source), ['package.json', 'api/go.mod', 'my svc/go.mod']);
  assert.equal(candidates[0].verify.test, 'npm test');
  assert.equal(candidates[1].dir, 'api');
  assert.equal(candidates[1].verify.build, 'cd api && go build ./...');
  assert.equal(candidates[1].verify.typecheck, null);
  assert.equal(candidates[2].dir, 'my svc');
  assert.equal(candidates[2].verify.test, 'cd "my svc" && go test ./...');
});

test('two manifests in one directory give two candidates', () => {
  const { candidates } = detect(mkRepo({ 'pyproject.toml': '[tool.pytest]', 'requirements.txt': 'pytest' }));
  assert.deepEqual(candidates.map((c) => c.source).sort(), ['pyproject.toml', 'requirements.txt']);
});

test('CLI prints one JSON line for the given path', () => {
  const root = mkRepo({ 'go.mod': 'module x\n' });
  const r = spawnSync(process.execPath, [DETECT, root], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(r.stdout).candidates[0].verify.test, 'go test ./...');
  const empty = spawnSync(process.execPath, [DETECT, mkRepo({})], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(empty.stdout), { candidates: [] });
});
