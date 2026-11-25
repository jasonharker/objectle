import { startGame } from './game.ts';

const puzzleNumber = document.querySelector('#puzzle-number')!;
const revealStage = document.querySelector('#reveal-stage')!;
const stage = document.querySelector('#stage')!;
const message = document.querySelector('#message')!;

try {
  const game = await startGame(fetch, localStorage);
  puzzleNumber.textContent = `#${game.puzzleNumber}`;
  revealStage.textContent = `Reveal Stage ${game.revealStage} of 6`;
  for (const asset of game.stageAssets) {
    const img = document.createElement('img');
    img.src = asset.url;
    img.alt = `Reveal Stage ${game.revealStage}`;
    stage.append(img);
  }
} catch {
  message.textContent = 'The game could not be loaded. Try again later.';
}
