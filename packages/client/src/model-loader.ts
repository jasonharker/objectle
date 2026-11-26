// The one place that knows a Guess Vocabulary model's file format. No doc
// fixes it yet (the bundle stores only a path; #5 decides only the Reveal
// Stage asset format), so it defaults to binary glTF; changing the format
// means changing this module and the API's media type for it.
import type { Object3D } from 'three';
import type { GameResponse } from '@objectle/shared';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { normalizeModel } from '@objectle/shared/shader';

/** The media type the API serves a model file as. */
export const modelMediaType = 'model/gltf-binary';

/**
 * The URL of the Daily Object's model, once a game has disclosed it: from
 * Reveal Stage 6, and at the game's end whatever stage it ended at
 * (ADR-0006). Before then no geometry has been served.
 */
export function dailyObjectModel({ stageAssets, endOfGame }: GameResponse): string | undefined {
  return (endOfGame?.lastStageAssets ?? stageAssets).find(({ mediaType }) => mediaType === modelMediaType)?.url;
}

/**
 * Fetch and parse a model, at the scale its file is authored in, already
 * drawn through the normalization shader.
 */
export async function loadModel(fetchFn: typeof fetch, url: string): Promise<Object3D> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`The model at ${url} could not be loaded (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  return normalizeModel(gltf.scene);
}
