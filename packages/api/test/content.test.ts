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

test('loads a past Schedule entry whose noun has left the Answer Pool, but not an active one', async () => {
  // A past Puzzle Number is never reassigned, so it may name a noun that has since left (ADR-0007).
  const dir = await editedFixture((bundle) => {
    bundle.schedule.push({ puzzleNumber: 4, noun: 'wooden spoon', pinned: false });
  });
  await expect(loadContent(dir, { activePuzzleNumber: 5 })).resolves.toBeDefined();
  await expect(loadContent(dir, { activePuzzleNumber: 4 })).rejects.toThrow(/Puzzle Number 4.*wooden spoon/);
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

test('refuses a Guess Vocabulary noun whose model file is missing', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.guessVocabulary[2].model = 'models/missing.glb';
  });
  await expect(loadContent(dir)).rejects.toThrow(/wooden spoon.*models\/missing\.glb/);
});

test('refuses an Answer Pool noun that is not in the Guess Vocabulary', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.guessVocabulary = bundle.guessVocabulary.filter(({ name }) => name !== 'pinecone');
  });
  await expect(loadContent(dir)).rejects.toThrow(/Answer Pool noun "pinecone".*Guess Vocabulary/);
});

test('refuses a Reveal Stage without assets', async () => {
  const dir = await editedFixture((bundle) => {
    bundle.answerPool[0].revealStages[3].assets = [];
  });
  await expect(loadContent(dir)).rejects.toThrow(/teapot.*Reveal Stage 4.*no assets/);
});

test.each([0, -0.1])('refuses a Guess Vocabulary noun with Size %s', async (size) => {
  const dir = await editedFixture((bundle) => {
    bundle.guessVocabulary[3].size = size;
  });
  await expect(loadContent(dir)).rejects.toThrow(/claw hammer.*Size/);
});
