import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentBundle } from '@objectle/shared';

export interface Content {
  bundle: ContentBundle;
  /** Stage asset bytes, keyed by their path in the bundle. */
  assets: Map<string, Buffer>;
}

/** Load a content bundle directory: bundle.json plus every stage asset it names. */
export async function loadContent(dir: string): Promise<Content> {
  const bundle: ContentBundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));
  const assets = new Map<string, Buffer>();
  for (const entry of bundle.answerPool) {
    for (const stage of entry.revealStages) {
      for (const path of stage.assets) assets.set(path, await readFile(join(dir, path)));
    }
  }
  return { bundle, assets };
}
