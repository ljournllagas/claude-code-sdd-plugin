import { test } from 'node:test';
import assert from 'node:assert/strict';

// Public API snapshot: a new export must be added here on purpose.
test('greet.js exports exactly greet', async () => {
  assert.deepEqual(Object.keys(await import('./greet.js')).sort(), ['greet']);
});
