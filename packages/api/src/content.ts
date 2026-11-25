import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ContentBundle } from '@objectle/shared';

/** A Reveal Stage asset, indexed at startup; its bytes stay on disk until it is requested. */
export interface StageAsset {
  /**
   * The SHA-256 of the asset's bytes, so neither its URL nor its payload
   * carries the noun or the bundle's file name.
   */
  id: string;
  mediaType: string;
  /** Path of the asset file. */
  file: string;
}

export interface Content {
  bundle: ContentBundle;
  /**
   * The Reveal Stages' assets of the Daily Object scheduled for a Puzzle
   * Number (index 0 is Reveal Stage 1), or undefined if none is scheduled.
   */
  revealStages(puzzleNumber: number): StageAsset[][] | undefined;
}

const mediaTypes: Record<string, string> = { '.svg': 'image/svg+xml' };

async function indexAsset(dir: string, path: string): Promise<StageAsset> {
  const file = join(dir, path);
  return {
    id: createHash('sha256').update(await readFile(file)).digest('hex'),
    mediaType: mediaTypes[extname(path)] ?? 'application/octet-stream',
    file,
  };
}

/**
 * Load a content bundle directory: bundle.json plus an index of every stage
 * asset it names. Throws, listing every problem, on a bundle the API could
 * not serve; the curation build's checks are the full ones.
 */
export async function loadContent(dir: string): Promise<Content> {
  const bundle: ContentBundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));

  const assetsByPath = new Map<string, StageAsset>();
  const stagesByNoun = new Map<string, StageAsset[][]>();
  for (const entry of bundle.answerPool) {
    const stages: StageAsset[][] = [];
    for (const stage of entry.revealStages) {
      const assets: StageAsset[] = [];
      for (const path of stage.assets) {
        if (!assetsByPath.has(path)) assetsByPath.set(path, await indexAsset(dir, path));
        assets.push(assetsByPath.get(path)!);
      }
      stages.push(assets);
    }
    stagesByNoun.set(entry.noun, stages);
  }

  const problems: string[] = [];
  for (const entry of bundle.answerPool) {
    if (entry.revealStages.length === 0) problems.push(`Answer Pool noun "${entry.noun}" has no Reveal Stages`);
  }
  for (const { puzzleNumber, noun } of bundle.schedule) {
    if (!stagesByNoun.has(noun)) {
      problems.push(`Puzzle Number ${puzzleNumber} is scheduled to "${noun}", which is not in the Answer Pool`);
    }
  }
  const pathById = new Map<string, string>();
  for (const [path, { id }] of assetsByPath) {
    const other = pathById.get(id);
    if (other !== undefined) problems.push(`stage assets ${other} and ${path} have the same asset id`);
    pathById.set(id, path);
  }
  if (problems.length > 0) throw new Error(`invalid content bundle in ${dir}:\n${problems.join('\n')}`);

  const scheduled = new Map(bundle.schedule.map((entry) => [entry.puzzleNumber, entry.noun]));
  return {
    bundle,
    revealStages: (puzzleNumber) => {
      const noun = scheduled.get(puzzleNumber);
      return noun === undefined ? undefined : stagesByNoun.get(noun);
    },
  };
}
