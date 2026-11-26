// The one place that knows a Guess Vocabulary model's file format. No doc
// fixes it yet (the bundle stores only a path; #5 decides only the Reveal
// Stage asset format), so it defaults to binary glTF; changing the format
// means changing this module and the API's media type for it.
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { normalizeModel } from '@objectle/shared/shader';

/** The media type the API serves a model file as. */
export const modelMediaType = 'model/gltf-binary';

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
