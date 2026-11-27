import type { Object3D } from 'three';
import type { GameResponse, WrongGuess } from '@objectle/shared';
import { creditItem } from './credit.ts';
import { guessHeadingRow, guessRow } from './guess-row.ts';
import { distributionRows } from './distribution.ts';
import { loadGuessVocabulary, outageMessage, startGame, submitGuess } from './game.ts';
import { dailyObjectModel, loadModel, modelMediaType } from './model-loader.ts';
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
const endSection = document.querySelector<HTMLElement>('#end-of-game')!;

let names: string[] = [];
let current: GameResponse | undefined;
/** What the Ghost view last drew: how many Ghosts, beside which Daily Object model, if any. */
let drawnGhosts = '';
/** Counts Ghost draws, so a draw that finishes after a later one began does not paint. */
let ghostDraw = 0;
/** Releases the current Ghost drawing, if there is one. */
let disposeGhosts = () => {};
/** Counts Reveal Stage draws, so a draw that finishes after a later one began does not paint. */
let stageDraw = 0;
/** Releases the current Reveal Stage's model drawings, if there are any. */
let disposeStage = () => {};

/**
 * Draw the Ghosts beside the Daily Object, in units of its Size: the hidden
 * ball, or its model once that is disclosed, which is shown even beside no Ghosts.
 */
async function drawGhosts(wrongGuesses: WrongGuess[], modelUrl: string | undefined) {
  drawnGhosts = `${wrongGuesses.length} ${modelUrl}`;
  const draw = ++ghostDraw;
  ghostView.hidden = wrongGuesses.length === 0 && modelUrl === undefined;
  if (ghostView.hidden) {
    disposeGhosts();
    disposeGhosts = () => {};
    return ghostView.replaceChildren();
  }
  const [dailyObject, ...ghosts] = await Promise.all([
    modelUrl === undefined
      ? hiddenDailyObject()
      : loadModel(fetch, modelUrl).then((model) => scaleToLongestDimension(model, 1)),
    ...wrongGuesses.map(async ({ ghost }) =>
      scaleToLongestDimension(await loadModel(fetch, ghost.url), ghost.relativeSize),
    ),
  ]);
  if (draw !== ghostDraw) return; // a later Guess, or another game, is being drawn
  const canvas = document.createElement('canvas');
  disposeGhosts();
  ghostView.replaceChildren(canvas);
  disposeGhosts = drawStage(canvas, dailyObject, ghosts);
}

/**
 * Show a Reveal Stage's assets: images as they are (pre-rendered through the
 * normalization shader, ADR-0006), models through the shader with free orbit.
 */
async function drawRevealStage({ revealStage, stageAssets }: GameResponse) {
  const draw = ++stageDraw;
  const assets = await Promise.all(
    stageAssets.map(async ({ url, mediaType }) => {
      if (mediaType === modelMediaType) return loadModel(fetch, url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Reveal Stage ${revealStage}`;
      return img;
    }),
  );
  if (draw !== stageDraw) return; // a later Guess, or another game, is being drawn
  disposeStage();
  const models = new Map<HTMLCanvasElement, Object3D>();
  stage.replaceChildren(
    ...assets.map((asset) => {
      if (asset instanceof HTMLImageElement) return asset;
      const canvas = document.createElement('canvas');
      models.set(canvas, asset);
      return canvas;
    }),
  );
  const disposers = [...models].map(([canvas, model]) => drawStage(canvas, model, [], { orbit: true }));
  disposeStage = () => disposers.forEach((dispose) => dispose());
}

function render(game: GameResponse) {
  const rolledOver = current !== undefined && current.puzzleNumber !== game.puzzleNumber;
  current = game;
  puzzleNumber.textContent = `#${game.puzzleNumber}`;
  revealStage.textContent = `Reveal Stage ${game.revealStage} of 6`;
  if (game.firstLetter !== null) revealStage.textContent += ` · First letter: ${game.firstLetter.toUpperCase()}`;
  drawRevealStage(game).catch(showError);
  guessList.replaceChildren(
    ...(game.guesses.length > 0 ? [guessHeadingRow()] : []),
    ...game.guesses.map((name) => guessRow(name, game.wrongGuesses.find(({ guess }) => guess === name)?.feedback)),
  );
  const modelUrl = dailyObjectModel(game);
  if (`${game.wrongGuesses.length} ${modelUrl}` !== drawnGhosts) drawGhosts(game.wrongGuesses, modelUrl).catch(showError);
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

function renderEndOfGame({ puzzleNumber, endOfGame, result }: GameResponse) {
  endSection.hidden = endOfGame === null;
  if (endOfGame === null) return;
  const { dailyObject, ghostCredits, distribution, beatPercentage } = endOfGame;
  document.querySelector('#daily-object')!.textContent = `The Daily Object was: ${dailyObject.name}`;
  document.querySelector('#beat-percentage')!.textContent =
    beatPercentage === null
      ? `You are the first to finish #${puzzleNumber}.`
      : `You beat ${Math.round(beatPercentage)}% of the other players who finished #${puzzleNumber}.`;
  const span = (className: string, text = '') => {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
  };
  document.querySelector('#distribution')!.replaceChildren(
    ...distributionRows(distribution, result).map(({ label, accessibleLabel, count, share, isPlayer }) => {
      const item = document.createElement('li');
      item.classList.toggle('is-player', isPlayer);
      // The visible label, bar and count repeat the hidden sentence, so screen readers skip them.
      const visible = [span('label', label), span('track'), span('count', String(count))];
      if (isPlayer) visible[0]!.append(' ', span('you', 'you'));
      visible[1]!.append(span('fill'));
      visible[1]!.style.setProperty('--share', String(share));
      for (const element of visible) element.setAttribute('aria-hidden', 'true');
      item.append(span('visually-hidden', accessibleLabel), ...visible);
      return item;
    }),
  );
  document.querySelector('#game-credits')!.replaceChildren(...[dailyObject, ...ghostCredits].map(creditItem));
}

// render() writes plain status text without touching data-tone; the submit handler clears an error tone before it can.
function setMessage(text: string, tone?: 'error') {
  message.textContent = text;
  if (tone) message.setAttribute('data-tone', tone);
  else message.removeAttribute('data-tone');
}

function showError(error: unknown) {
  setMessage(error instanceof Error ? error.message : outageMessage, 'error');
}

guessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const typed = guessInput.value.trim().toLowerCase();
  const guess = names.find((name) => name.toLowerCase() === typed);
  if (!guess) {
    guessInput.setAttribute('aria-invalid', 'true');
    guessInput.setAttribute('aria-describedby', 'message');
    setMessage('Pick a Guess from the suggestions.', 'error');
    return;
  }
  if (message.hasAttribute('data-tone')) setMessage('');
  // Disabling a focused control drops focus; it goes back afterwards.
  const focused = [guessInput, guessButton].find((control) => control === document.activeElement);
  guessInput.disabled = guessButton.disabled = true;
  guessButton.setAttribute('aria-busy', 'true');
  guessButton.textContent = 'Guessing…';
  try {
    render(await submitGuess(fetch, localStorage, guess));
    guessInput.value = '';
  } catch (error) {
    showError(error);
  } finally {
    guessInput.disabled = guessButton.disabled = false;
    guessButton.removeAttribute('aria-busy');
    guessButton.textContent = 'Guess';
    focused?.focus();
  }
});

guessInput.addEventListener('input', () => {
  guessInput.removeAttribute('aria-invalid');
  guessInput.removeAttribute('aria-describedby');
});

// The game is shown as soon as it starts, whether or not the suggestions load.
const vocabulary = loadGuessVocabulary(fetch);
let started = false;
try {
  render(await startGame(fetch, localStorage));
  started = true;
} catch (error) {
  showError(error);
}
try {
  names = await vocabulary;
  suggestions.replaceChildren(
    ...names.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      return option;
    }),
  );
} catch (error) {
  // A failed start already says why; don't replace that with this.
  if (started) showError(error);
}
