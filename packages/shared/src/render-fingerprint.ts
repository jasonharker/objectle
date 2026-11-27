// Render fingerprints (ADR-0006): what each Reveal Stage asset was rendered
// from, so the curation build can tell without rendering whether a committed
// stage is still current. The stage-authoring tool records one beside every
// stage it renders, and the curation build recomputes it, both through
// stageFingerprints. The render settings it covers are defined here too, free
// of three.js, so Node tools read them without loading it. Web Crypto only, so
// it runs in Node and the browser alike.
import { revealStageCount } from './index.ts';
import { stageImageSize } from './stage-assets.ts';

/**
 * The shared palette definition. `depth` (levels per hue) and `blackFloor`
 * (brightness of the darkest level) are the two tuning settings; change them
 * here and every consumer of the shader follows, and every Reveal Stage needs
 * rendering again.
 */
export const palette = {
  /** Brightness levels per hue; ADR-0002 allows 8–16. */
  depth: 12,
  /** Brightness of the darkest level, lifted above pure black. */
  blackFloor: 0.12,
  /** Hues the palette snaps to, evenly spaced round the colour wheel. */
  hues: 24,
  /** Saturation steps from grey to full colour. */
  saturations: 5,
} as const;

export interface RenderSettings {
  /** Pixels per side of a Reveal Stage image. */
  resolution: number;
  depth: number;
  blackFloor: number;
  hues: number;
  saturations: number;
}

/** The render settings Reveal Stages are rendered with now: the image resolution and the palette. */
export const renderSettings: RenderSettings = { resolution: stageImageSize, ...palette };

/**
 * The version of the shared render code: the normalization shader
 * (shader.ts), the stage looks, cameras and lighting, and the asset encoding
 * (packages/authoring/src/stage-render.ts and asset-bytes.ts). Bump it with
 * any change to them that can change a rendered asset; every Reveal Stage
 * then needs rendering again.
 */
export const renderCodeVersion = 1;

/** One Reveal Stage's render inputs, each as a SHA-256 hex digest but the render-code version. */
export interface RenderFingerprint {
  /** The noun's prepared model file. */
  model: string;
  /** The stage's Stage Camera; Reveal Stage 6's is Reveal Stage 5's, which its export carries. */
  stageCamera: string;
  renderSettings: string;
  renderCode: number;
}

async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The fingerprints of all six Reveal Stages of a noun, rendered from `model`
 * (its prepared model file's bytes) and `stageCameras` (those of Reveal Stages
 * 1-5, as recorded). `settings` and `renderCode` are the current ones unless
 * given. A Stage Camera is hashed by its position, target and field of view
 * alone, so key order and extra fields in hand-edited JSON don't matter.
 */
export async function stageFingerprints(
  model: Uint8Array,
  stageCameras: unknown[],
  { settings = renderSettings, renderCode = renderCodeVersion }: { settings?: RenderSettings; renderCode?: number } = {},
): Promise<RenderFingerprint[]> {
  const modelDigest = await sha256(model);
  const { resolution, depth, blackFloor, hues, saturations } = settings;
  const settingsDigest = await sha256(JSON.stringify([resolution, depth, blackFloor, hues, saturations]));
  const fingerprints: RenderFingerprint[] = [];
  for (let stage = 0; stage < revealStageCount; stage++) {
    const camera = stageCameras[Math.min(stage, revealStageCount - 2)] as Record<string, unknown> | null | undefined;
    fingerprints.push({
      model: modelDigest,
      stageCamera: await sha256(JSON.stringify([camera?.position, camera?.target, camera?.fov])),
      renderSettings: settingsDigest,
      renderCode,
    });
  }
  return fingerprints;
}
