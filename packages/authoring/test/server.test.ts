// The stage-authoring tool's local server as any web page could reach it:
// saving must come from the tool's own page, not from a cross-origin form
// or no-cors fetch. Tests check only the response status and answer-pool.json.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startAuthoringServer } from '../src/server.ts';

let dir: string;
let url: string;
let close: () => Promise<void>;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'objectle-authoring-server-'));
  await writeFile(join(dir, 'guess-vocabulary.json'), JSON.stringify([{ name: 'teapot', model: 'models/teapot.glb' }]));
  await writeFile(join(dir, 'answer-pool.json'), '[]');
  const started = await startAuthoringServer(dir, 0);
  url = started.url;
  close = () => started.server.close();
});
afterAll(() => close?.());

// Refused for its noun, so an accepted request answers 200 with problems and writes nothing either way.
const body = JSON.stringify({ object: { noun: 'kettle' }, images: [], model: '' });
const save = (headers: Record<string, string>) => fetch(new URL('/authoring/save', url), { method: 'POST', headers, body });

describe('the authoring server’s save endpoint', () => {
  test('accepts JSON from the tool’s own page', async () => {
    const response = await save({ origin: new URL(url).origin, 'content-type': 'application/json' });
    expect(response.status).toBe(200);
    expect((await response.json()).problems.join('\n')).toContain('kettle is not in the Guess Vocabulary');
  });

  test.each([
    ['a cross-origin no-cors text/plain POST', { origin: 'https://example.com', 'content-type': 'text/plain;charset=UTF-8' }, 403],
    ['a cross-origin JSON POST', { origin: 'https://example.com', 'content-type': 'application/json' }, 403],
    ['a same-origin POST that is not JSON', { 'content-type': 'text/plain;charset=UTF-8' }, 415],
  ])('refuses %s', async (_, headers, status) => {
    const response = await save(headers);
    expect(response.status).toBe(status);
    expect(JSON.parse(await readFile(join(dir, 'answer-pool.json'), 'utf8'))).toEqual([]);
  });
});
