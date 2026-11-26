import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { revealStageCount, type ContentBundle, type GuessVocabularyEntry } from '@objectle/shared';
import { stageAssetProblems } from '@objectle/shared/stage-assets';

export { revealStageCount };

/** A Reveal Stage asset, indexed at startup; its bytes stay on disk until it is requested. */
export interface StageAsset {
  /**
   * The SHA-256 of the asset's bytes, so nothing derived from it carries the
   * noun or the bundle's file name. A Ghost model's URL is this id; a Reveal
   * Stage asset's is keyed by the API (ADR-0006).
   */
  id: string;
  mediaType: string;
  /** Path of the asset file. */
  file: string;
}

export interface Content {
  bundle: ContentBundle;
  /** Name of the Daily Object scheduled for a Puzzle Number, or undefined if none is scheduled. */
  dailyObject(puzzleNumber: number): string | undefined;
  /**
   * The Reveal Stages' assets of the Daily Object scheduled for a Puzzle
   * Number (index 0 is Reveal Stage 1), or undefined if none is scheduled.
   */
  revealStages(puzzleNumber: number): StageAsset[][] | undefined;
  /** A Guess Vocabulary noun's entry, or undefined if it is not in the Guess Vocabulary. */
  noun(name: string): GuessVocabularyEntry | undefined;
  /** A Guess Vocabulary noun's model, indexed like a stage asset: its id is the SHA-256 of its bytes. */
  modelOf(name: string): StageAsset | undefined;
  /** The Guess Vocabulary model with an id, or undefined if there is none. */
  modelById(id: string): StageAsset | undefined;
}

const mediaTypes: Record<string, string> = { '.webp': 'image/webp', '.glb': 'model/gltf-binary' };

function asset(file: string, bytes: Buffer): StageAsset {
  return {
    id: createHash('sha256').update(bytes).digest('hex'),
    mediaType: mediaTypes[extname(file)] ?? 'application/octet-stream',
    file,
  };
}

async function indexAsset(dir: string, path: string): Promise<StageAsset> {
  const file = join(dir, path);
  return asset(file, await readFile(file));
}

/**
 * Load a content bundle directory: bundle.json plus an index of every stage
 * asset it names. Throws, listing every problem, on a bundle the API could
 * not serve; the curation build's checks are the full ones.
 */
export async function loadContent(dir: string): Promise<Content> {
  const bundle: ContentBundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));

  const problems: string[] = [];
  const assetsByPath = new Map<string, StageAsset>();
  const stagesByNoun = new Map<string, StageAsset[][]>();
  for (const entry of bundle.answerPool) {
    const stages: StageAsset[][] = [];
    for (const [index, stage] of entry.revealStages.entries()) {
      const assets: StageAsset[] = [];
      for (const path of stage.assets) {
        const file = join(dir, path);
        const bytes = await readFile(file);
        for (const problem of stageAssetProblems(index + 1, bytes)) {
          problems.push(`Answer Pool noun "${entry.noun}" Reveal Stage ${index + 1} asset ${path} ${problem}`);
        }
        if (!assetsByPath.has(path)) assetsByPath.set(path, asset(file, bytes));
        assets.push(assetsByPath.get(path)!);
      }
      stages.push(assets);
    }
    stagesByNoun.set(entry.noun, stages);
  }

  const models = new Map<string, StageAsset>();
  for (const { name, model, size } of bundle.guessVocabulary) {
    if (!(size > 0)) problems.push(`Guess Vocabulary noun "${name}" has Size ${size}, which is not positive`);
    try {
      models.set(name, await indexAsset(dir, model));
    } catch {
      problems.push(`Guess Vocabulary noun "${name}" has no readable model file ${model}`);
    }
  }
  const inVocabulary = new Set(bundle.guessVocabulary.map(({ name }) => name));
  for (const entry of bundle.answerPool) {
    if (!inVocabulary.has(entry.noun)) {
      problems.push(`Answer Pool noun "${entry.noun}" has no Guess Vocabulary entry`);
    }
    if (entry.revealStages.length !== revealStageCount) {
      problems.push(
        `Answer Pool noun "${entry.noun}" has ${entry.revealStages.length} Reveal Stages, not ${revealStageCount}`,
      );
    }
    for (const [index, stage] of entry.revealStages.entries()) {
      if (stage.assets.length === 0) problems.push(`Answer Pool noun "${entry.noun}" Reveal Stage ${index + 1} has no assets`);
    }
  }
  for (const { puzzleNumber, noun } of bundle.schedule) {
    if (!stagesByNoun.has(noun)) {
      problems.push(`Puzzle Number ${puzzleNumber} is scheduled to "${noun}", which is not in the Answer Pool`);
    }
  }
  const pathById = new Map<string, string>();
  const modelPathById = new Map(bundle.guessVocabulary.map(({ name, model }) => [models.get(name)?.id, model]));
  for (const [path, { id }] of assetsByPath) {
    const other = pathById.get(id);
    if (other !== undefined) problems.push(`stage assets ${other} and ${path} have the same asset id`);
    pathById.set(id, path);
    // Ghosts are served with their names, so a stage asset with a model's bytes names the Daily Object (ADR-0006).
    const model = modelPathById.get(id);
    if (model !== undefined) {
      problems.push(`stage asset ${path} has the same bytes as the Guess Vocabulary model ${model}, which a Ghost would match`);
    }
  }
  if (problems.length > 0) throw new Error(`invalid content bundle in ${dir}:\n${problems.join('\n')}`);

  const scheduled = new Map(bundle.schedule.map((entry) => [entry.puzzleNumber, entry.noun]));
  const nouns = new Map(bundle.guessVocabulary.map((entry) => [entry.name, entry]));
  const modelsById = new Map([...models.values()].map((model) => [model.id, model]));
  return {
    noun: (name) => nouns.get(name),
    modelOf: (name) => models.get(name),
    modelById: (id) => modelsById.get(id),
    bundle,
    dailyObject: (puzzleNumber) => scheduled.get(puzzleNumber),
    revealStages: (puzzleNumber) => {
      const noun = scheduled.get(puzzleNumber);
      return noun === undefined ? undefined : stagesByNoun.get(noun);
    },
  };
}
