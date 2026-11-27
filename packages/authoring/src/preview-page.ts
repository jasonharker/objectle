/// <reference types="vite/client" />
// A Reveal Stage as a player sees it, framed by the tool at phone width: the
// game's own stylesheet, markup and drawing code (stage-view.ts and
// model-loader.ts), fed the rendered assets instead of the API's.
import '@objectle/client/style.css';
import { loadModel } from '@objectle/client/model-loader';
import { drawStage } from '@objectle/client/stage-view';

export interface PreviewStage {
  revealStage: number;
  /** An object URL of the stage's rendered asset. */
  url: string;
  /** The first letter of the noun, shown from Reveal Stage 6. */
  firstLetter: string | null;
}

declare global {
  interface Window {
    showStage(stage: PreviewStage): Promise<void>;
  }
}

const stage = document.querySelector('#stage')!;
const label = document.querySelector('#reveal-stage')!;
let dispose = () => {};
let draw = 0;

// As main.ts's render() and drawRevealStage() show a GameResponse.
window.showStage = async ({ revealStage, url, firstLetter }) => {
  const current = ++draw;
  label.textContent = `Reveal Stage ${revealStage} of 6`;
  if (firstLetter !== null) label.textContent += ` · First letter: ${firstLetter.toUpperCase()}`;
  dispose();
  dispose = () => {};
  if (revealStage < 6) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Reveal Stage ${revealStage}`;
    stage.replaceChildren(img);
    return;
  }
  const model = await loadModel(fetch, url);
  if (current !== draw) return;
  const canvas = document.createElement('canvas');
  stage.replaceChildren(canvas);
  dispose = drawStage(canvas, model, [], { orbit: true });
};
