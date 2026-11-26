// The stage-authoring tool as a curator uses it: its page driven in headless
// Chromium against a content directory. Tests check what the page shows and
// what saving writes. Needs a Chromium with WebGL; skipped without one.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { stageAssetProblems } from '@objectle/shared/stage-assets';
import { buildContent } from '@objectle/curation';
import { chromiumPath, launchChromium } from '../src/chromium.ts';
import { startAuthoringServer } from '../src/server.ts';
import { caddy, caddyModel } from './fixture-model.ts';

type Json = any;

async function contentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-tool-'));
  await mkdir(join(dir, 'models'));
  const nouns = ['tea caddy', 'kettle'];
  await writeFile(
    join(dir, 'guess-vocabulary.json'),
    JSON.stringify(
      nouns.map((name, index) => ({
        name,
        model: `models/model-${index}.glb`,
        category: 'Cooking & Dining',
        size: 0.16,
        naturalOrMade: 'made',
        primaryMaterial: 'metal',
        credit: { author: 'A', source: 'test', license: 'CC0-1.0' },
      })),
    ),
  );
  for (const index of [0, 1]) await writeFile(join(dir, `models/model-${index}.glb`), caddyModel([0.5, 0.2 + index / 10, 0.1]));
  await writeFile(join(dir, 'answer-pool.json'), '[]');
  await writeFile(join(dir, 'pins.json'), '[]');
  await writeFile(join(dir, 'schedule.json'), '[]');
  return dir;
}

const views: Record<number, [string, string, string]> = {
  1: ['0, 0, -0.12', '0, 0, 0', '20'],
  2: ['0.3, 0.15, -0.4', '0, 0, 0', '30'],
  3: ['-0.25, 0.1, -0.3', '0, 0, 0', '25'],
  4: ['-0.3, 0.2, -0.35', '0, 0, 0', '30'],
  5: ['0.3, 0.2, 0.4', '0, 0, 0', '30'],
};

const numbers = (text: string) => text.split(',').map(Number);

let browser: Browser;
beforeAll(async () => {
  if (chromiumPath() !== undefined) browser = await launchChromium();
});
afterAll(() => browser?.close());

async function openTool(dir: string): Promise<Page> {
  const { url, server } = await startAuthoringServer(dir, 0);
  const page = await browser.newPage();
  page.on('close', () => server.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByLabel('Answer Pool object').selectOption('tea caddy');
  await page.getByText('Model loaded').waitFor();
  expect(errors).toEqual([]);
  return page;
}

async function view(page: Page, stage: number, [position, target, fov]: [string, string, string]) {
  await page.getByLabel(`Reveal Stage ${stage}`, { exact: true }).check();
  await page.getByLabel('Camera position').fill(position);
  await page.getByLabel('Camera target').fill(target);
  await page.getByLabel('Field of view').fill(fov);
  await page.getByLabel('Field of view').press('Enter');
}

const readJson = async (dir: string, file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'));

describe.skipIf(chromiumPath() === undefined)('the stage-authoring tool', { timeout: 60_000 }, () => {
  test('saves a Stage Camera per Reveal Stage and the Difficulty Rating, which the curation build accepts', async () => {
    const dir = await contentDir();
    const page = await openTool(dir);
    for (const stage of [1, 2, 3, 4, 5]) {
      await view(page, stage, views[stage]);
      await page.getByRole('button', { name: 'Use this view as the Stage Camera' }).click();
    }
    await page.getByLabel('Difficulty Rating').selectOption('hard');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Saved tea caddy').waitFor();
    await page.close();

    const [entry] = await readJson(dir, 'answer-pool.json');
    expect(entry.noun).toBe('tea caddy');
    expect(entry.difficultyRating).toBe('hard');
    entry.revealStages.slice(0, 5).forEach(({ stageCamera }: Json, index: number) => {
      const [position, target, fov] = views[index + 1];
      expect(stageCamera).toEqual({ position: numbers(position), target: numbers(target), fov: Number(fov) });
    });
    for (const [index, { assets }] of entry.revealStages.entries()) {
      expect(stageAssetProblems(index + 1, await readFile(join(dir, assets[0])))).toEqual([]);
    }
    const built = await buildContent(dir, join(dir, 'bundle'), { launchDate: '2027-03-01', now: new Date('2027-03-01T20:00:00Z') });
    expect(built.problems).toEqual([]);

    // Reopened, the tool shows what was saved.
    const reopened = await openTool(dir);
    expect(await reopened.getByLabel('Difficulty Rating').inputValue()).toBe('hard');
    await reopened.getByLabel('Reveal Stage 3', { exact: true }).check();
    expect(numbers(await reopened.getByLabel('Camera position').inputValue())).toEqual(numbers(views[3][0]));
    await reopened.close();
  });

  test('warns live when a Reveal Stage 1 view frames background, and refuses to save it', async () => {
    const dir = await contentDir();
    const page = await openTool(dir);
    await view(page, 1, ['0, 0, -0.5', '0, 0, 0', '30']);
    await page.getByText('this view frames background').waitFor();
    await view(page, 1, views[1]);
    await page.getByText('this view frames background').waitFor({ state: 'detached' });

    await view(page, 1, ['0, 0, -0.5', '0, 0, 0', '30']);
    for (const stage of [1, 2, 3, 4, 5]) {
      if (stage > 1) await view(page, stage, views[stage]);
      await page.getByRole('button', { name: 'Use this view as the Stage Camera' }).click();
    }
    await page.getByLabel('Difficulty Rating').selectOption('easy');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Reveal Stage 1 Stage Camera frames background').waitFor();
    await page.close();
    expect(await readJson(dir, 'answer-pool.json')).toEqual([]);
  });

  test('marks text by dragging over it, then warns when a Reveal Stage 1-3 view frames it', async () => {
    const dir = await contentDir();
    const page = await openTool(dir);
    // Face the label (+Z) and drag across the middle of the view.
    const front: [string, string, string] = [`0, 0, ${caddy.depth / 2 + 0.4}`, '0, 0, 0', '30'];
    await view(page, 5, front);
    await page.getByRole('button', { name: 'Mark text' }).click();
    const box = (await page.locator('#view').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await page.getByText('1 text mark').waitFor();

    await view(page, 3, front);
    await page.getByText('this view frames marked text').waitFor();
    await view(page, 2, front);
    await page.getByText('this view frames marked text').waitFor({ state: 'detached' });

    for (const stage of [1, 2, 3, 4, 5]) {
      await view(page, stage, views[stage]);
      await page.getByRole('button', { name: 'Use this view as the Stage Camera' }).click();
    }
    await page.getByLabel('Difficulty Rating').selectOption('medium');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Saved tea caddy').waitFor();
    await page.close();
    const [entry] = await readJson(dir, 'answer-pool.json');
    expect(entry.textMarks).toHaveLength(1);
    expect(entry.textMarks[0].material).toBe(1);
  });

  test('previews each Reveal Stage in the player’s layout: an image for stages 1-5, free orbit and the first letter at 6', async () => {
    const dir = await contentDir();
    const page = await openTool(dir);
    for (const stage of [1, 2, 3, 4, 5]) {
      await view(page, stage, views[stage]);
      await page.getByRole('button', { name: 'Use this view as the Stage Camera' }).click();
    }
    await page.getByRole('button', { name: 'Preview' }).click();
    const player = page.frameLocator('#player');
    await page.getByLabel('Reveal Stage 2', { exact: true }).check();
    await player.getByText('Reveal Stage 2 of 6').waitFor();
    const size = await player.locator('#stage img').evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
    expect(size).toEqual([1024, 1024]);

    await page.getByLabel('Reveal Stage 6', { exact: true }).check();
    await player.getByText('Reveal Stage 6 of 6 · First letter: T').waitFor();
    await player.locator('#stage canvas').waitFor();
    await page.close();
  });
});
