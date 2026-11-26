// The API refuses to start on a content bundle it could not serve, instead
// of failing requests later. Full curation checks belong to the curation build.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ContentBundle } from '@objectle/shared';
import { loadContent } from '../src/app.ts';
import { copyFixture } from './harness.ts';

async function editedFixture(edit: (bundle: ContentBundle) => void): Promise<string> {
  const dir = await copyFixture();
  const bundle: ContentBundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));
  edit(bundle);
  await writeFile(join(dir, 'bundle.json'), JSON.stringify(bundle));
  return dir;
}

test('loads the fixture bundle', async () => {
  await expect(loadContent(await copyFixture())).resolves.toBeDefined();
});

test('refuses a Schedule entry whose noun is not in the Answer Pool', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.schedule.push({ puzzleNumber: 4, noun: 'wooden spoon', pinned: false });
  });
  await expect(loadContent(dir)).rejects.toThrow(/Puzzle Number 4.*wooden spoon.*Answer Pool/);
});

test('refuses an Answer Pool entry without Reveal Stages', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.answerPool[1].revealStages = [];
  });
  await expect(loadContent(dir)).rejects.toThrow(/pinecone.*Reveal Stages/);
});

test('refuses an Answer Pool entry without six Reveal Stages', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.answerPool[0].revealStages.pop();
  });
  await expect(loadContent(dir)).rejects.toThrow(/teapot.*5 Reveal Stages/);
});

test('refuses two stage assets with the same asset id', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.answerPool[1].revealStages[0].assets = ['assets/pinecone-copy.svg'];
  });
  await copyFile(join(dir, 'assets/teapot-stage-1.svg'), join(dir, 'assets/pinecone-copy.svg'));
  await expect(loadContent(dir)).rejects.toThrow(/assets\/teapot-stage-1\.svg.*assets\/pinecone-copy\.svg/);
});

test('reports every problem at once', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.answerPool[1].revealStages = [];
    bundle.schedule.push({ puzzleNumber: 4, noun: 'claw hammer', pinned: false });
  });
  await expect(loadContent(dir)).rejects.toThrow(/pinecone[^]*claw hammer|claw hammer[^]*pinecone/);
});
