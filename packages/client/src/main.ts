import type { GameResponse } from '@objectle/shared';
import { creditItem } from './credit.ts';
import { loadGuessVocabulary, outageMessage, startGame, submitGuess } from './game.ts';

const puzzleNumber = document.querySelector('#puzzle-number')!;
const revealStage = document.querySelector('#reveal-stage')!;
const stage = document.querySelector('#stage')!;
const message = document.querySelector('#message')!;
const guessForm = document.querySelector<HTMLFormElement>('#guess-form')!;
const guessInput = document.querySelector<HTMLInputElement>('#guess')!;
const guessButton = guessForm.querySelector('button')!;
const suggestions = document.querySelector('#guess-vocabulary')!;
const guessList = document.querySelector('#guesses')!;
const endSection = document.querySelector<HTMLElement>('#end-of-game')!;

let names: string[] = [];
let current: GameResponse | undefined;

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
      item.textContent = name;
      return item;
    }),
  );
  guessForm.hidden = game.result !== null;
  if (game.result === null) {
    message.textContent = rolledOver ? `A new Puzzle Number has started: #${game.puzzleNumber}.` : '';
  } else {
    message.textContent = game.result.solved
      ? `Solved at Reveal Stage ${game.result.revealStage}.`
      : 'Not solved in six Guesses.';
  }
  renderEndOfGame(game);
}

function renderEndOfGame({ puzzleNumber, endOfGame }: GameResponse) {
  endSection.hidden = endOfGame === null;
  if (endOfGame === null) return;
  const { dailyObject, ghostCredits, distribution, beatPercentage } = endOfGame;
  document.querySelector('#daily-object')!.textContent = `The Daily Object was: ${dailyObject.name}`;
  document.querySelector('#beat-percentage')!.textContent =
    beatPercentage === null
      ? `You are the first to finish #${puzzleNumber}.`
      : `You beat ${Math.round(beatPercentage)}% of the other players who finished #${puzzleNumber}.`;
  const rows = [
    ...distribution.solved.map((count, index) => [`Solved at Reveal Stage ${index + 1}`, count] as const),
    ['Not solved', distribution.failed] as const,
  ];
  document.querySelector('#distribution')!.replaceChildren(
    ...rows.map(([label, count]) => {
      const item = document.createElement('li');
      item.textContent = `${label}: ${count}`;
      return item;
    }),
  );
  document.querySelector('#game-credits')!.replaceChildren(...[dailyObject, ...ghostCredits].map(creditItem));
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
