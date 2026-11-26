// The tool pages' side of the authoring server's endpoints (server.ts).
import type { AuthoredObject } from './content-store.ts';
import type { SaveRequest } from './server.ts';
import { loadSourceModel, type SourceModel } from './stage-render.ts';

export async function fetchModel(noun: string): Promise<SourceModel> {
  const response = await fetch(`/authoring/model?noun=${encodeURIComponent(noun)}`);
  if (!response.ok) throw new Error(`the model of ${noun} could not be loaded (${response.status})`);
  return loadSourceModel(await response.arrayBuffer());
}

const base64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/** Save an authored object and its rendered assets; returns why they were refused, if they were. */
export async function saveObject(object: AuthoredObject, { images, model }: { images: Uint8Array[]; model: Uint8Array }) {
  const request: SaveRequest = { object, images: images.map(base64), model: base64(model) };
  const response = await fetch('/authoring/save', { method: 'POST', body: JSON.stringify(request) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result.problems as string[];
}
