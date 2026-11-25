import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { startApi } from './harness.ts';

test('serves the built client from the same origin', async () => {
  const clientDir = await mkdtemp(join(tmpdir(), 'objectle-client-'));
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>Objectle</title>');
  const api = await startApi({ now: '2027-03-01T20:00:00Z', clientDir });

  const page = await api.inject({ method: 'GET', url: '/' });
  expect(page.statusCode).toBe(200);
  expect(page.headers['content-type']).toMatch(/^text\/html/);
  expect(page.body).toContain('<title>Objectle</title>');
});
