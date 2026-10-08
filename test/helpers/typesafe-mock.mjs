import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const readFixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
export const fixtureRequest = () => readFixture('typesafe-example-request.json');
export const fixtureResponse = () => readFixture('typesafe-example-response.json');

// Builds a response body in the live TypeSafe wire format that carries the values of `raw`
// (same shape extractRaw returns): a clone of fixtureResponse() with exactly the values extractRaw
// reads overwritten. A null value removes the field, so extractRaw reads it back as null.
export function encodeResponse(raw) {
  const body = structuredClone(fixtureResponse());
  const a = body.answers;
  const put = (obj, key, v) => { if (v === null || v === undefined) delete obj[key]; else obj[key] = v; };
  put(a.kind, 'choice', raw.kind);
  const c = raw.complexity ?? {};
  if (Array.isArray(c.levels)) {
    a.complexity.probabilities = Object.fromEntries(c.levels.map((p, i) => [String(i), p]));
    const sum = c.levels.reduce((s, p) => s + p, 0);
    a.complexity.score = sum > 0 ? c.levels.reduce((s, p, i) => s + i * p, 0) / sum : 0; // keep score = Σ index×p
    const legend = a.complexity.legend;
    a.complexity.legend = Object.fromEntries(c.levels.map((_, i) => [String(i), legend[String(i)] ?? `Level ${i}`]));
  } else {
    delete a.complexity.probabilities;
    delete a.complexity.score;
  }
  put(a.complexity, 'confidence', c.confidence);
  for (const id of ['ambiguous', 'irreversible', 'cross_file']) put(a[id], 'noul', raw[id]);
  put(body, 'usage', raw.usage);
  return body;
}

export async function startMock(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(rec);
      handler(rec, res, requests.length);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1/systemone`,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

export const json = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
