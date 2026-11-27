// What the stage-authoring tool reads from a content directory and writes
// back to it. Terms follow GLOSSARY.md. Saving records an Answer Pool
// object's Stage Cameras, Difficulty Rating and text marks in
// answer-pool.json, and its six Reveal Stage assets beside it with their
// render fingerprints, in the shape the curation build reads
// (packages/curation/src/build.ts). Node-only.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { difficultyRatings, revealStageCount, type DifficultyRating } from '@objectle/shared';
import { stageFingerprints } from '@objectle/shared/render-fingerprint';
import { stageAssetProblems } from '@objectle/shared/stage-assets';
import { isStageCamera, isTextMark, type StageCamera, type TextMark } from './stage-camera.ts';

export type { StageCamera, TextMark } from './stage-camera.ts';

/** Reveal Stages 1-5 each have a Stage Camera; stage 6 is viewed from stage 5's. */
export const stageCameraCount = revealStageCount - 1;

/** What the curator authors for one Answer Pool object. */
export interface AuthoredObject {
  noun: string;
  difficultyRating: DifficultyRating;
  /** The Stage Cameras of Reveal Stages 1-5, in order. */
  stageCameras: [StageCamera, StageCamera, StageCamera, StageCamera, StageCamera];
  /** Where the model carries readable text, which no Stage Camera for Reveal Stages 1-3 may frame. */
  textMarks: TextMark[];
}

/** The rendered Reveal Stage assets: images of stages 1-5 and the stage-6 model. */
export interface RenderedAssets {
  images: Uint8Array[];
  model: Uint8Array;
}

export interface AuthoringContent {
  /** Every Guess Vocabulary noun and its model's path in the content directory. */
  guessVocabulary: { name: string; model: string }[];
  /** Every Answer Pool object that already has its Stage Cameras. */
  authored: AuthoredObject[];
}

type Json = Record<string, any>;

async function readArray(contentDir: string, file: string, missing?: Json[]): Promise<Json[]> {
  let text: string;
  try {
    text = await readFile(join(contentDir, file), 'utf8');
  } catch (error) {
    if (missing !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') return missing;
    throw new Error(`${file} cannot be read from ${contentDir}`);
  }
  const value = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error(`${file} is not a JSON array`);
  return value;
}

/** A recorded Answer Pool entry as authored, or undefined if its Stage Cameras are not all recorded yet. */
function authoredOf(entry: Json): AuthoredObject | undefined {
  const stageCameras = Array.isArray(entry.revealStages)
    ? entry.revealStages.slice(0, stageCameraCount).map((stage: Json) => stage?.stageCamera)
    : [];
  if (stageCameras.length !== stageCameraCount || !stageCameras.every(isStageCamera)) return undefined;
  return {
    noun: entry.noun,
    difficultyRating: entry.difficultyRating,
    stageCameras: stageCameras as AuthoredObject['stageCameras'],
    textMarks: Array.isArray(entry.textMarks) ? entry.textMarks : [],
  };
}

export async function readAuthoringContent(contentDir: string): Promise<AuthoringContent> {
  const vocabulary = await readArray(contentDir, 'guess-vocabulary.json');
  const answerPool = await readArray(contentDir, 'answer-pool.json', []);
  return {
    guessVocabulary: vocabulary.map(({ name, model }) => ({ name, model })),
    authored: answerPool.flatMap((entry) => authoredOf(entry) ?? []),
  };
}

/** Why `object` cannot be recorded; empty if it can. */
function authoredProblems({ noun, difficultyRating, stageCameras, textMarks }: AuthoredObject, names: Set<string>) {
  const problems: string[] = [];
  const label = `Answer Pool object "${noun}"`;
  if (!names.has(noun)) problems.push(`${noun} is not in the Guess Vocabulary`);
  if (difficultyRating === undefined || difficultyRating === null) problems.push(`${label} has no Difficulty Rating`);
  else if (!difficultyRatings.includes(difficultyRating)) {
    problems.push(`${label} has Difficulty Rating ${JSON.stringify(difficultyRating)}, which is not easy, medium or hard`);
  }
  if (!Array.isArray(stageCameras) || stageCameras.length !== stageCameraCount) {
    problems.push(`${label} needs a Stage Camera for each of Reveal Stages 1-${stageCameraCount}`);
  } else {
    stageCameras.forEach((camera, index) => {
      if (!isStageCamera(camera)) {
        problems.push(
          `${label} Reveal Stage ${index + 1} has a Stage Camera that is not a position, a different target and a field of view`,
        );
      }
    });
  }
  (Array.isArray(textMarks) ? textMarks : [null]).forEach((mark, index) => {
    if (!isTextMark(mark)) problems.push(`${label} text mark ${index + 1} is not a material and a UV rectangle`);
  });
  return problems;
}

const slug = (noun: string) => noun.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

/**
 * Record an authored Answer Pool object and its rendered Reveal Stage assets
 * in `contentDir`, replacing any earlier entry for its noun and keeping every
 * other entry as it was, and refusing asset paths another entry records.
 * Returns every problem found; when there are any, nothing is written.
 */
export async function saveAuthoredObject(
  contentDir: string,
  object: AuthoredObject,
  { images, model }: RenderedAssets,
): Promise<string[]> {
  const vocabulary = await readArray(contentDir, 'guess-vocabulary.json');
  const names = new Set(vocabulary.map(({ name }) => name));
  const answerPool = await readArray(contentDir, 'answer-pool.json', []);
  const problems = authoredProblems(object, names);
  // ponytail: the model is read at save, not when it was rendered; re-preparing it while the tool has the old one
  // loaded records the new bytes. Send the rendered bytes' digest with the save if that race ever bites.
  const modelPath = vocabulary.find(({ name }) => name === object.noun)?.model;
  const modelBytes = modelPath === undefined ? undefined : await readFile(join(contentDir, modelPath)).catch(() => undefined);
  if (modelPath !== undefined && modelBytes === undefined) problems.push(`the model of ${object.noun}, ${modelPath}, cannot be read`);
  const assets = [...images, model].map((bytes) => Buffer.from(bytes));
  if (assets.length !== revealStageCount) problems.push(`there are ${assets.length} Reveal Stage assets, not ${revealStageCount}`);
  assets.forEach((bytes, index) => {
    for (const problem of stageAssetProblems(index + 1, bytes)) {
      problems.push(`the rendered asset of Reveal Stage ${index + 1} ${problem}`);
    }
  });
  const paths = assets.map((_, index) => `assets/${slug(object.noun)}-stage-${index + 1}.${index < stageCameraCount ? 'webp' : 'glb'}`);
  // Nouns differing only in case or punctuation share a slug; saving one would overwrite the other's assets.
  for (const other of answerPool) {
    if (other.noun === object.noun || !Array.isArray(other.revealStages)) continue;
    const taken = other.revealStages.flatMap((stage: Json) => (Array.isArray(stage?.assets) ? stage.assets : []));
    if (paths.some((path) => taken.includes(path))) {
      problems.push(`Answer Pool object "${object.noun}" would write its Reveal Stage assets over those of "${other.noun}"`);
    }
  }
  if (problems.length > 0) return problems;

  const fingerprints = await stageFingerprints(modelBytes!, object.stageCameras);
  await mkdir(join(contentDir, 'assets'), { recursive: true });
  await Promise.all(paths.map((path, index) => writeFile(join(contentDir, path), assets[index])));

  const entry = {
    noun: object.noun,
    difficultyRating: object.difficultyRating,
    textMarks: object.textMarks,
    revealStages: paths.map((path, index) =>
      index < stageCameraCount
        ? { stageCamera: object.stageCameras[index], assets: [path], fingerprint: fingerprints[index] }
        : { assets: [path], fingerprint: fingerprints[index] },
    ),
  };
  const index = answerPool.findIndex(({ noun }) => noun === object.noun);
  if (index === -1) answerPool.push(entry);
  else answerPool[index] = entry;
  // Written last, so answer-pool.json never records Stage Cameras whose assets were not written.
  await writeFile(join(contentDir, 'answer-pool.json'), `${JSON.stringify(answerPool, null, 2)}\n`);
  return [];
}
