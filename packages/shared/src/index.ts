// The content bundle schema (produced by the curation build, consumed by the
// scoring API) and the scoring API's response shapes. Terms follow GLOSSARY.md.

export interface Credit {
  author: string;
  source: string;
  license: string;
}

export interface GuessVocabularyEntry {
  name: string;
  /** Path of the noun's model, relative to the bundle directory. */
  model: string;
  /** One of the twelve Categories (set still to be written down, #3). */
  category: string;
  /** Size: the longest dimension, in metres, of a typical example of the noun (ADR-0005). */
  size: number;
  naturalOrMade: 'natural' | 'made';
  /** One of the enumerated Primary Materials (set still to be written down, #3). */
  primaryMaterial: string;
  credit: Credit;
  inAnswerPool: boolean;
}

export interface RevealStage {
  /** Paths of the stage's assets, relative to the bundle directory. */
  assets: string[];
}

export interface AnswerPoolEntry {
  /** Name of the Guess Vocabulary noun. */
  noun: string;
  /** Reveal Stages in order; index 0 is Reveal Stage 1. */
  revealStages: RevealStage[];
  difficultyRating: 'easy' | 'medium' | 'hard';
}

export interface ScheduleEntry {
  puzzleNumber: number;
  /** Name of the Answer Pool noun that is the Daily Object. */
  noun: string;
  pinned: boolean;
}

export interface ContentBundle {
  guessVocabulary: GuessVocabularyEntry[];
  answerPool: AnswerPoolEntry[];
  schedule: ScheduleEntry[];
}

export interface StageAsset {
  url: string;
}

/** How a game ended: solved at a Reveal Stage, or failed after six Guesses. */
export type Result = { solved: true; revealStage: number } | { solved: false };

/**
 * A game's current position: the response to "start or resume"
 * (POST /api/game) and to a Guess (POST /api/guess).
 */
export interface GameResponse {
  playToken: string;
  puzzleNumber: number;
  revealStage: number;
  stageAssets: StageAsset[];
  /** Guess Vocabulary names guessed so far, in order. */
  guesses: string[];
  /** The game's Result, or null while it is still being played. */
  result: Result | null;
}

/** Request body of "start or resume": the stored Play Token, if any. */
export interface GameRequest {
  playToken?: string;
}

/** Request body of a Guess. */
export interface GuessRequest {
  playToken: string;
  guess: string;
}

/** Response to GET /api/guess-vocabulary: names only, never Attributes. */
export interface GuessVocabularyResponse {
  names: string[];
}

/** Body of every refused request. */
export interface ErrorResponse {
  error: string;
}
