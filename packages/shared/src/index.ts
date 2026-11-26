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
  /** Real-world size in metres. Which dimension it measures is still open (#4). */
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

/** Response to "start or resume" (POST /api/game). */
export interface GameResponse {
  playToken: string;
  puzzleNumber: number;
  revealStage: number;
  stageAssets: StageAsset[];
}
