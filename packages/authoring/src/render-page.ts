// The headless render page: renders recorded Stage Cameras into Reveal Stage
// assets and saves them, through the same code as the tool's preview. The
// command-line tool calls window.renderAnswerPool.
import type { AuthoringContent } from './content-store.ts';
import { saveObject, fetchModel } from './tool-api.ts';
import { renderRevealStages, stageRenderer } from './stage-render.ts';

declare global {
  interface Window {
    /** Render and save the named Answer Pool objects, or every authored one; returns every problem. */
    renderAnswerPool(nouns: string[]): Promise<string[]>;
  }
}

window.renderAnswerPool = async (nouns) => {
  const content: AuthoringContent = await (await fetch('/authoring/content')).json();
  const wanted = nouns.length > 0 ? nouns : content.authored.map(({ noun }) => noun);
  const renderer = stageRenderer(document.createElement('canvas'));
  const problems: string[] = [];
  try {
    for (const noun of wanted) {
      const object = content.authored.find((authored) => authored.noun === noun);
      if (object === undefined) {
        problems.push(`${noun} has no recorded Stage Cameras`);
        continue;
      }
      // One object failing to load, render or save is that object's problem; the rest still render.
      try {
        const model = await fetchModel(noun);
        const rendered = await renderRevealStages(renderer, model, object.stageCameras, object.textMarks);
        if (rendered.problems.length > 0) {
          problems.push(...rendered.problems.map((problem) => `Answer Pool object "${noun}" ${problem}`));
        } else {
          problems.push(...(await saveObject(object, rendered)));
        }
      } catch (error) {
        problems.push(`Answer Pool object "${noun}" could not be rendered: ${(error as Error).message}`);
      }
    }
  } finally {
    renderer.dispose();
  }
  return problems;
};
