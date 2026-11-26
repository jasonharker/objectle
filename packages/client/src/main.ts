import type { Feedback, GameResponse, WrongGuess } from '@objectle/shared';
import { loadGuessVocabulary, outageMessage, startGame, submitGuess } from './game.ts';
import { loadModel } from './model-loader.ts';
import { drawStage, hiddenDailyObject, scaleToLongestDimension } from './stage-view.ts';

const puzzleNumber = document.querySelector('#puzzle-number')!;
const revealStage = document.querySelector('#reveal-stage')!;
const stage = document.querySelector('#stage')!;
const message = document.querySelector('#message')!;
const guessForm = document.querySelector<HTMLFormElement>('#guess-form')!;
const guessInput = document.querySelector<HTMLInputElement>('#guess')!;
const guessButton = guessForm.querySelector('button')!;
const suggestions = document.querySelector('#guess-vocabulary')!;
const guessList = document.querySelector('#guesses')!;
const ghostView = document.querySelector<HTMLElement>('#ghosts')!;

let names: string[] = [];
let current: GameResponse | undefined;
let drawnGhosts = 0;

const sizeText: Record<Feedback['size'], string> = {
  bigger: 'the Daily Object is bigger',
  smaller: 'the Daily Object is smaller',
  similar: 'similar',
};

function feedbackText({ category, size, naturalOrMade, primaryMaterial }: Feedback): string {
  return `Category: ${category} · Size: ${sizeText[size]} · Natural vs. made: ${naturalOrMade} · Primary Material: ${primaryMaterial}`;
}

/** Draw the Ghosts beside the hidden Daily Object, in units of its Size. */
async function drawGhosts(wrongGuesses: WrongGuess[]) {
  drawnGhosts = wrongGuesses.length;
  ghostView.hidden = wrongGuesses.length === 0;
  if (wrongGuesses.length === 0) return ghostView.replaceChildren();
  const ghosts = await Promise.all(
    wrongGuesses.map(async ({ ghost }) => scaleToLongestDimension(await loadModel(fetch, ghost.url), ghost.relativeSize)),
  );
  if (drawnGhosts !== wrongGuesses.length) return; // a later Guess is being drawn
  const canvas = document.createElement('canvas');
  ghostView.replaceChildren(canvas);
  drawStage(canvas, hiddenDailyObject(), ghosts);
}

function render(game: GameResponse) {
  const rolledOver = current !== undefined && current.puzzleNumber !== game.puzzleNumber;
  current = game;
  puzzleNumber.textContent = `#${game.puzzleNumber}`;
  revealStage.textContent = `Reveal Stage ${game.revealStage} of 6`;
  stage.replaceChildren(
    ...game.stageAssets.map((asset) => {
      const img = document.createElement('img');
      img.src = asset.url;
      img.alt = `Reveal Stage ${game.revealStage}`;
      return img;
    }),
  );
  guessList.replaceChildren(
    ...game.guesses.map((name) => {
      const item = document.createElement('li');
      const wrong = game.wrongGuesses.find(({ guess }) => guess === name);
      item.textContent = wrong ? `${name}: ${feedbackText(wrong.feedback)}` : name;
      return item;
    }),
  );
  if (game.wrongGuesses.length !== drawnGhosts) drawGhosts(game.wrongGuesses).catch(showError);
  guessForm.hidden = game.result !== null;
  if (game.result === null) {
    message.textContent = rolledOver ? `A new Puzzle Number has started: #${game.puzzleNumber}.` : '';
  } else {
    message.textContent = game.result.solved
      ? `Solved at Reveal Stage ${game.result.revealStage}.`
      : 'Not solved in six Guesses.';
  }
}

function showError(error: unknown) {
  message.textContent = error instanceof Error ? error.message : outageMessage;
}

guessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const typed = guessInput.value.trim().toLowerCase();
  const guess = names.find((name) => name.toLowerCase() === typed);
  if (!guess) {
    message.textContent = 'Pick a Guess from the suggestions.';
    return;
  }
  guessButton.disabled = true;
  try {
    render(await submitGuess(fetch, localStorage, guess));
    guessInput.value = '';
  } catch (error) {
    showError(error);
  } finally {
    guessButton.disabled = false;
  }
});

try {
  const [game, vocabulary] = await Promise.all([startGame(fetch, localStorage), loadGuessVocabulary(fetch)]);
  names = vocabulary;
  suggestions.replaceChildren(
    ...names.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      return option;
    }),
  );
  render(game);
} catch (error) {
  showError(error);
}
