// The API refuses to start on a content bundle it could not serve, instead
// of failing requests later. Full curation checks belong to the curation build.
import { readFileSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ContentBundle } from '@objectle/shared';
import { loadContent } from '../src/app.ts';
import { copyFixture, fixtureDir, startApi } from './harness.ts';

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

test('refuses a bundle built for another Launch Date, naming both, and loads one built for the configured one', async () => {
  // The fixture is built for 2027-03-01; the Launch Date's one source is the API's configuration (ADR-0008).
  const now = '2027-03-01T20:00:00Z';
  await expect(startApi({ now, launchDate: '2027-03-02', contentDir: fixtureDir })).rejects.toThrow(
    /Launch Date 2027-03-01.*configured Launch Date 2027-03-02/,
  );
  const api = await startApi({ now, launchDate: '2027-03-01', contentDir: fixtureDir });
  expect((await api.inject({ method: 'POST', url: '/api/game', payload: {} })).statusCode).toBe(200);
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
    bundle.answerPool[1].revealStages[0].assets = ['assets/pinecone-copy.webp'];
  });
  await copyFile(join(dir, 'assets/teapot-stage-1.webp'), join(dir, 'assets/pinecone-copy.webp'));
  await expect(loadContent(dir)).rejects.toThrow(/assets\/teapot-stage-1\.webp.*assets\/pinecone-copy\.webp/);
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

describe('Reveal Stage asset format (ADR-0006)', () => {
  /** A fixture copy with one stage asset's file replaced by other bytes. */
  async function withAsset(path: string, edit: (bytes: Buffer) => Buffer): Promise<string> {
    const dir = await copyFixture();
    await writeFile(join(dir, path), edit(await readFile(join(dir, path))));
    return dir;
  }

  /** A binary glTF with its JSON chunk edited; the binary chunk is kept as it is. */
  function editGlb(glb: Buffer, edit: (json: Record<string, any>) => void): Buffer {
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
    edit(json);
    let text = Buffer.from(JSON.stringify(json));
    text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
    const rest = glb.subarray(20 + jsonLength);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + text.length + rest.length, 8);
    header.writeUInt32LE(text.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    return Buffer.concat([header, text, rest]);
  }

  /** A RIFF chunk: four-character code, little-endian size, data, padding to an even length. */
  const chunk = (code: string, data: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(code, 'latin1');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
  };
  const riff = (...chunks: Buffer[]) => {
    const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
    const header = Buffer.from('RIFF\0\0\0\0', 'latin1');
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  /** The image data of a simple-format lossless WebP: its VP8L chunk's payload. */
  const vp8l = (webp: Buffer) => webp.subarray(20, 20 + webp.readUInt32LE(16));

  test('loads lossless 1024×1024 WebP images for Reveal Stages 1–5 and a binary glTF for stage 6', async () => {
    const content = await loadContent(await copyFixture());
    for (const puzzleNumber of [1, 2]) {
      expect(content.revealStages(puzzleNumber)!.map((assets) => assets.map(({ mediaType }) => mediaType))).toEqual([
        ...Array(5).fill(['image/webp']),
        ['model/gltf-binary'],
      ]);
    }
  });

  test.each([
    ['an SVG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>teapot</title></svg>'), /not a WebP/],
    ['a lossy WebP', (webp: Buffer) => riff(chunk('VP8 ', vp8l(webp))), /not a lossless WebP/],
    [
      'a WebP carrying metadata',
      (webp: Buffer) =>
        riff(chunk('VP8X', Buffer.alloc(10)), chunk('VP8L', vp8l(webp)), chunk('EXIF', Buffer.from('teapot'))),
      /not a lossless WebP/,
    ],
    [
      'a WebP with a trailing chunk',
      (webp: Buffer) => riff(chunk('VP8L', vp8l(webp)), chunk('XMP ', Buffer.from('teapot'))),
      /besides its image/,
    ],
    [
      'a 512×512 WebP',
      (webp: Buffer) => {
        const data = Buffer.from(vp8l(webp));
        data.writeUInt32LE(((data.readUInt32LE(1) & ~0xfffffff) | (511 << 14) | 511) >>> 0, 1);
        return riff(chunk('VP8L', data));
      },
      /512×512, not 1024×1024/,
    ],
  ])('refuses a Reveal Stage 1–5 asset that is %s', async (_, edit, problem) => {
    const dir = await withAsset('assets/teapot-stage-3.webp', edit);
    await expect(loadContent(dir)).rejects.toThrow(/teapot.*Reveal Stage 3.*assets\/teapot-stage-3\.webp/);
    await expect(loadContent(dir)).rejects.toThrow(problem);
  });

  test.each([
    ['a name', (json: Record<string, any>) => void (json.nodes[0].name = 'Teapot'), /carries a name/],
    ['extras', (json: Record<string, any>) => void (json.meshes[0].extras = { source: 'teapot' }), /carries extras/],
    ['generator metadata', (json: Record<string, any>) => void (json.asset.generator = 'Teapot exporter'), /generator/],
    ['a copyright notice', (json: Record<string, any>) => void (json.asset.copyright = 'Fixture Author A'), /copyright/],
    [
      'a reference to another file',
      (json: Record<string, any>) => void (json.images = [{ uri: 'teapot-texture.png' }]),
      /another file/,
    ],
  ])('refuses a Reveal Stage 6 model that carries %s', async (_, edit, problem) => {
    const dir = await withAsset('assets/teapot-stage-6.glb', (glb) => editGlb(glb, edit));
    await expect(loadContent(dir)).rejects.toThrow(/teapot.*Reveal Stage 6.*assets\/teapot-stage-6\.glb/);
    await expect(loadContent(dir)).rejects.toThrow(problem);
  });

  test('refuses a Reveal Stage 6 asset that is not a binary glTF', async () => {
    const dir = await withAsset('assets/pinecone-stage-6.glb', () => Buffer.from('{"asset":{"version":"2.0"}}'));
    await expect(loadContent(dir)).rejects.toThrow(/pinecone.*Reveal Stage 6.*not a binary glTF/);
  });

  test('refuses a stage asset with the same bytes as a Guess Vocabulary model, which a Ghost would match', async () => {
    const dir = await withAsset('assets/teapot-stage-6.glb', () => readFileSync(join(fixtureDir, 'models/teapot.glb')));
    await expect(loadContent(dir)).rejects.toThrow(/teapot-stage-6\.glb.*same bytes.*models\/teapot\.glb/);
  });
});
