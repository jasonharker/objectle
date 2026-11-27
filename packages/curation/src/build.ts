// The curation build: checks a content directory and writes the content bundle
// the scoring API loads, or lists every problem it found. Terms follow
// GLOSSARY.md.
//
// A content directory holds the curation input files below plus the model and
// stage asset files they name, by paths relative to the directory. Answer Pool
// membership is having an entry in answer-pool.json. Each Reveal Stage lists
// its asset files as given, checked against the ADR-0006 stage asset format;
// the stage-authoring tool (packages/authoring) renders them from the Stage
// Cameras it records beside them, which the build ignores. The previously
// published Schedule is not a curation input: it is the schedule in the
// bundle.json of the previous bundle, the one being served (ADR-0008), or
// empty on a first publish. The build extends it around the Pins in pins.json
// ({ date, noun }, by Pacific date) by ADR-0007.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import {
  categories,
  difficultyRatings,
  primaryMaterials,
  revealStageCount,
  type AnswerPoolEntry,
  type ContentBundle,
  type GuessVocabularyEntry,
  type ScheduleEntry,
} from '@objectle/shared';
import { stageAssetProblems } from '@objectle/shared/stage-assets';
import { dayOf, pacificDateAt, planSchedule } from './schedule.ts';

export const inputFiles = {
  guessVocabulary: 'guess-vocabulary.json',
  answerPool: 'answer-pool.json',
  pins: 'pins.json',
} as const;

export interface BuildOptions {
  /** Pacific date of Puzzle Number 1, YYYY-MM-DD. */
  launchDate: string;
  /** The instant the build runs at, which decides the active Puzzle Number. */
  now: Date;
  /** The previous bundle's directory, whose Schedule the build extends; without one, the Schedule starts empty. */
  previousBundle?: string;
  /** Mixed into the shuffle that breaks ties between equally eligible objects. */
  seed?: string;
}

export interface BuildResult {
  /** Every content problem found; when there are any, nothing is written. */
  problems: string[];
  /** What a passing build reports: a Schedule shortfall and each Difficulty Pattern substitution. */
  notices: string[];
  /** A passing build's Schedule from the active Puzzle Number on (from Puzzle Number 1 before launch). */
  upcoming: ScheduleEntry[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isMissing = (value: unknown) => value === undefined || value === null;
const oneOf = <T extends string>(set: readonly T[], value: unknown): value is T => set.includes(value as T);

/**
 * Whether a Reveal Stage image (already a simple lossless WebP) has any pixel
 * that is not opaque, where the client's backdrop would show (ADR-0006). Read
 * from the VP8L header's alpha_is_used bit, after the 14-bit width and height,
 * which the encoder (libwebp, behind Chromium's canvas) sets exactly when one
 * does; decoding every stage-1 image would only repeat its answer.
 */
const showsBackground = (webp: Buffer) => ((webp.readUInt32LE(21) >>> 28) & 1) === 1;

/** Whether a path names a file inside the content directory, so it lands inside the bundle directory too. */
export function staysInside(path: string): boolean {
  const normalized = normalize(path);
  return !isAbsolute(path) && normalized !== '..' && !normalized.startsWith(`..${sep}`);
}

export async function readInput(contentDir: string, file: string, problems: string[]): Promise<unknown[] | undefined> {
  let text: string;
  try {
    text = await readFile(join(contentDir, file), 'utf8');
  } catch {
    problems.push(`${file} is missing from the content directory`);
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    problems.push(`${file} is not valid JSON: ${(error as Error).message}`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    problems.push(`${file} is not a JSON array`);
    return undefined;
  }
  return value;
}

/** The Schedule in a previous bundle's bundle.json, or undefined having said why it can't be read. */
async function readPreviousSchedule(previousBundle: string, problems: string[]): Promise<unknown[] | undefined> {
  const file = join(previousBundle, 'bundle.json');
  let bundle: unknown;
  try {
    bundle = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    problems.push(`previous bundle ${file} can't be read: ${(error as Error).message}`);
    return undefined;
  }
  if (!isObject(bundle) || !Array.isArray(bundle.schedule)) {
    problems.push(`previous bundle ${file} has no Schedule`);
    return undefined;
  }
  return bundle.schedule;
}

/** Why a noun's Credit can't be shown, if it can't: every model needs an author, source and license. */
export function creditProblems(credit: unknown, label: string): string[] {
  if (isMissing(credit)) return [`${label} has no Credit`];
  if (!isObject(credit)) return [`${label} has a Credit that is not an author, source and license`];
  return ['author', 'source', 'license'].flatMap((field) =>
    isText(credit[field]) ? [] : [`${label} has a Credit with no ${field}`],
  );
}

/**
 * Build the content bundle for `contentDir` into `bundleDir`: bundle.json
 * plus a copy of every model and stage asset it names, with the Schedule
 * extended as of `now`. Returns every problem found; when there are any,
 * nothing is written.
 */
export async function buildContent(
  contentDir: string,
  bundleDir: string,
  { launchDate, now, previousBundle, seed = '' }: BuildOptions,
): Promise<BuildResult> {
  const problems: string[] = [];
  try {
    if ((await readdir(bundleDir)).length > 0) problems.push(`bundle directory ${bundleDir} is not empty`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push(`bundle directory ${bundleDir} is not a directory that can be written to`);
    }
  }

  const vocabularyInput = await readInput(contentDir, inputFiles.guessVocabulary, problems);
  const answerPoolInput = await readInput(contentDir, inputFiles.answerPool, problems);
  const pinsInput = await readInput(contentDir, inputFiles.pins, problems);
  const scheduleInput = previousBundle === undefined ? [] : await readPreviousSchedule(previousBundle, problems);

  /** Every file the bundle names, so each is copied once. */
  const files = new Set<string>();
  /** Read a named file, or explain why it can't be. */
  async function check(path: unknown, what: string, label: string): Promise<Buffer | undefined> {
    if (!isText(path)) {
      problems.push(`${label} has ${what} ${JSON.stringify(path)}, which is not a file path`);
    } else if (!staysInside(path)) {
      problems.push(`${label} has ${what} ${path}, which is outside the content directory`);
    } else {
      try {
        const bytes = await readFile(join(contentDir, path));
        files.add(path);
        return bytes;
      } catch {
        problems.push(`${label} has no readable ${what} file ${path}`);
      }
    }
    return undefined;
  }

  const answerPoolNouns = new Set(
    (answerPoolInput ?? []).flatMap((entry) => (isObject(entry) && isText(entry.noun) ? [entry.noun] : [])),
  );

  const guessVocabulary: GuessVocabularyEntry[] = [];
  const names = new Set<string>();
  /** Model paths by the hash of their bytes: a stage asset with a model's bytes would match its Ghost. */
  const modelsByHash = new Map<string, string>();
  for (const [index, entry] of (vocabularyInput ?? []).entries()) {
    if (!isObject(entry) || !isText(entry.name)) {
      problems.push(`Guess Vocabulary entry ${index + 1} has no name`);
      continue;
    }
    const { name, model, category, size, naturalOrMade, primaryMaterial, credit } = entry;
    const label = `Guess Vocabulary noun "${name}"`;
    if (names.has(name)) problems.push(`${label} is in the Guess Vocabulary more than once`);
    names.add(name);

    if (isMissing(model)) problems.push(`${label} has no model`);
    else {
      const bytes = await check(model, 'model', label);
      if (bytes !== undefined) modelsByHash.set(createHash('sha256').update(bytes).digest('hex'), model as string);
    }

    if (isMissing(category)) problems.push(`${label} has no Category`);
    else if (!oneOf(categories, category)) {
      problems.push(`${label} has Category ${JSON.stringify(category)}, which is not a Category`);
    }

    if (isMissing(size)) problems.push(`${label} has no Size`);
    else if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      problems.push(`${label} has Size ${JSON.stringify(size)}, which is not a positive number of metres`);
    }

    if (isMissing(naturalOrMade)) problems.push(`${label} has no natural vs. made`);
    else if (naturalOrMade !== 'natural' && naturalOrMade !== 'made') {
      problems.push(`${label} has natural vs. made ${JSON.stringify(naturalOrMade)}, which is neither natural nor made`);
    }

    if (isMissing(primaryMaterial)) problems.push(`${label} has no Primary Material`);
    else if (!oneOf(primaryMaterials, primaryMaterial)) {
      problems.push(`${label} has Primary Material ${JSON.stringify(primaryMaterial)}, which is not a Primary Material`);
    }

    problems.push(...creditProblems(credit, label));

    guessVocabulary.push({
      name,
      model,
      category,
      size,
      naturalOrMade,
      primaryMaterial,
      credit: isObject(credit) ? { author: credit.author, source: credit.source, license: credit.license } : credit,
      inAnswerPool: answerPoolNouns.has(name),
    } as GuessVocabularyEntry);
  }

  const answerPool: AnswerPoolEntry[] = [];
  const answerPoolSeen = new Set<string>();
  /** Stage asset paths by the hash of their bytes: the API names a stage asset by that hash. */
  const stageAssetsByHash = new Map<string, string>();
  for (const [index, entry] of (answerPoolInput ?? []).entries()) {
    if (!isObject(entry) || !isText(entry.noun)) {
      problems.push(`Answer Pool entry ${index + 1} has no noun`);
      continue;
    }
    const { noun, revealStages, difficultyRating } = entry;
    const label = `Answer Pool object "${noun}"`;
    if (answerPoolSeen.has(noun)) problems.push(`${label} is in the Answer Pool more than once`);
    answerPoolSeen.add(noun);
    if (vocabularyInput !== undefined && !names.has(noun)) problems.push(`${label} is not in the Guess Vocabulary`);

    const stages: AnswerPoolEntry['revealStages'] = [];
    if (!Array.isArray(revealStages) || revealStages.length === 0) problems.push(`${label} has no Reveal Stages`);
    else {
      if (revealStages.length !== revealStageCount) {
        problems.push(`${label} has ${revealStages.length} Reveal Stages, not ${revealStageCount}`);
      }
      for (const [stageIndex, stage] of revealStages.entries()) {
        const stageLabel = `${label} Reveal Stage ${stageIndex + 1}`;
        const assets: unknown[] = isObject(stage) && Array.isArray(stage.assets) ? stage.assets : [];
        if (assets.length === 0) problems.push(`${stageLabel} has no assets`);
        for (const asset of assets) {
          const bytes = await check(asset, 'asset', stageLabel);
          if (bytes === undefined) continue;
          const formatProblems = stageAssetProblems(stageIndex + 1, bytes);
          for (const problem of formatProblems) {
            problems.push(`${stageLabel} has asset ${asset as string}, which ${problem}`);
          }
          if (stageIndex === 0 && formatProblems.length === 0 && showsBackground(bytes)) {
            problems.push(
              `${stageLabel} has asset ${asset as string}, which shows background, so its Stage Camera frames the outline ahead of Reveal Stage 2`,
            );
          }
          const hash = createHash('sha256').update(bytes).digest('hex');
          const model = modelsByHash.get(hash);
          if (model !== undefined) {
            problems.push(
              `${stageLabel} has asset ${asset as string}, whose bytes are the same as the model ${model}'s, which a Ghost would match`,
            );
          }
          const other = stageAssetsByHash.get(hash);
          if (other !== undefined && other !== asset) {
            problems.push(`${stageLabel} has asset ${asset as string}, whose bytes are the same as ${other}'s`);
          }
          stageAssetsByHash.set(hash, asset as string);
        }
        stages.push({ assets: assets as string[] });
      }
    }

    if (isMissing(difficultyRating)) problems.push(`${label} has no Difficulty Rating`);
    else if (!oneOf(difficultyRatings, difficultyRating)) {
      problems.push(
        `${label} has Difficulty Rating ${JSON.stringify(difficultyRating)}, which is not easy, medium or hard`,
      );
    }

    answerPool.push({ noun, revealStages: stages, difficultyRating } as AnswerPoolEntry);
  }

  const launchDay = dayOf(launchDate);
  if (launchDay === undefined) problems.push(`Launch Date ${JSON.stringify(launchDate)} is not a YYYY-MM-DD date`);
  if (Number.isNaN(now.getTime())) problems.push('the build was given no valid instant to run at');
  /** The active Puzzle Number; 0 or less before launch. */
  const active =
    launchDay === undefined || Number.isNaN(now.getTime()) ? NaN : dayOf(pacificDateAt(now))! - launchDay + 1;

  // A past Puzzle Number may name a noun that has since left the Answer Pool;
  // the active one may not, as it can never be reassigned (ADR-0007).
  const previous: ScheduleEntry[] = [];
  const puzzleNumbers = new Set<number>();
  for (const [index, entry] of (scheduleInput ?? []).entries()) {
    const puzzleNumber = isObject(entry) ? entry.puzzleNumber : undefined;
    if (!isObject(entry) || typeof puzzleNumber !== 'number' || !Number.isInteger(puzzleNumber) || puzzleNumber < 1) {
      problems.push(
        `Schedule entry ${index + 1} has Puzzle Number ${JSON.stringify(puzzleNumber)}, which is not a whole number from 1`,
      );
      continue;
    }
    if (puzzleNumbers.has(puzzleNumber)) problems.push(`Puzzle Number ${puzzleNumber} is scheduled more than once`);
    puzzleNumbers.add(puzzleNumber);
    if (!isText(entry.noun)) problems.push(`Puzzle Number ${puzzleNumber} is scheduled to no noun`);
    else if (puzzleNumber === active && answerPoolInput !== undefined && !answerPoolNouns.has(entry.noun)) {
      problems.push(
        `Puzzle Number ${puzzleNumber} is active and scheduled to ${JSON.stringify(entry.noun)}, which is not in the ` +
          'Answer Pool; an active Puzzle Number is never reassigned',
      );
    }
    previous.push({ puzzleNumber, noun: entry.noun as string, pinned: entry.pinned === true });
  }

  /** Pinned nouns by Puzzle Number. */
  const pins = new Map<number, string>();
  /** Every Pin's date, so a date Pinned twice is reported once. */
  const pinDates = new Set<string>();
  for (const [index, entry] of (pinsInput ?? []).entries()) {
    const date = isObject(entry) ? entry.date : undefined;
    const day = dayOf(date);
    if (!isObject(entry) || day === undefined) {
      problems.push(`Pin ${index + 1} has date ${JSON.stringify(date)}, which is not a YYYY-MM-DD date`);
      continue;
    }
    const label = `Pin on ${date as string}`;
    if (pinDates.has(date as string)) problems.push(`${date as string} has more than one Pin`);
    pinDates.add(date as string);
    if (!isText(entry.noun)) problems.push(`${label} has no noun`);
    else if (answerPoolInput !== undefined && !answerPoolNouns.has(entry.noun)) {
      problems.push(`${label} is to ${JSON.stringify(entry.noun)}, which is not in the Answer Pool`);
    }
    if (launchDay === undefined || Number.isNaN(active)) continue;
    const puzzleNumber = day - launchDay + 1;
    if (puzzleNumber < 1) problems.push(`${label} is before the Launch Date`);
    else if (puzzleNumber < active) problems.push(`${label} is on a past date (Puzzle Number ${puzzleNumber})`);
    else if (puzzleNumber === active) problems.push(`${label} is on the active date (Puzzle Number ${puzzleNumber})`);
    pins.set(puzzleNumber, entry.noun as string);
  }

  if (problems.length > 0) return { problems, notices: [], upcoming: [] };

  const { schedule, notices } = planSchedule({
    answerPool: new Map(answerPool.map(({ noun, difficultyRating }) => [noun, difficultyRating])),
    pins,
    previous,
    active,
    launchDay: launchDay!,
    seed,
  });

  await mkdir(bundleDir, { recursive: true });
  for (const file of files) {
    await mkdir(dirname(join(bundleDir, file)), { recursive: true });
    await copyFile(join(contentDir, file), join(bundleDir, file));
  }
  const bundle: ContentBundle = { guessVocabulary, answerPool, schedule };
  // Written last, so a build that dies part-way leaves no bundle the API would load.
  await writeFile(join(bundleDir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  return { problems: [], notices, upcoming: schedule.filter(({ puzzleNumber }) => puzzleNumber >= active) };
}
