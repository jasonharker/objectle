// The one render path for Reveal Stages 1-5 and the stage-6 export (ADR-0006),
// used both by the tool's live view and preview and by the headless render
// that writes the assets, so the curator previews exactly what is written.
// Every surface and clay render goes through the shared normalization shader
// (ADR-0002). Browser-only.
import {
  Box3,
  Color,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Sphere,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { normalizeModel, paletteColor, type Rgb } from '@objectle/shared/shader';
import { stageImageSize } from '@objectle/shared/stage-assets';
import { simpleLosslessWebp, scrubbedGlb } from './asset-bytes.ts';
import type { StageCamera, TextMark } from './stage-camera.ts';

/** A noun's model as loaded for authoring: its scene, at the file's scale, with its source materials. */
export interface SourceModel {
  scene: Object3D;
  /** Each source material's index in the model's glTF, which text marks refer to. */
  materialIndex: WeakMap<Material, number>;
}

export async function loadSourceModel(bytes: ArrayBuffer): Promise<SourceModel> {
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const materialIndex = new WeakMap<Material, number>();
  gltf.scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    for (const material of [mesh.material].flat()) {
      const index = gltf.parser.associations.get(material)?.materials;
      if (index !== undefined) materialIndex.set(material, index);
    }
  });
  return { scene: gltf.scene, materialIndex };
}

/** How Reveal Stages 1-5 draw the model, and the text-mark check's view of it. */
export type Look = 'surface' | 'silhouette' | 'clay' | 'text';

/** The look of Reveal Stages 1-5: surface, silhouette, surface, clay, surface. */
export const stageLook = (revealStage: number): Look =>
  revealStage === 2 ? 'silhouette' : revealStage === 4 ? 'clay' : 'surface';

const srgb = ([r, g, b]: Rgb) => new Color().setRGB(r, g, b, SRGBColorSpace);
/** The silhouette's one flat colour: a light palette grey, against the client's dark backdrop. */
const silhouetteColour = srgb(paletteColor([0.85, 0.84, 0.8]));
/** Clay's one neutral colour, shaded through the normalization shader. */
const clayColour = srgb([0.72, 0.7, 0.66]);

/** Most text marks one material can carry; the tool merges marks long before this. */
export const marksPerMaterial = 64;
/** Pads the marks array: a UV rectangle nothing falls inside. */
const noMark = new Vector4(2, 2, -1, -1);

/**
 * Draws a mesh white where it carries marked text and black elsewhere,
 * occluded as the model is. Every material shares one program, so each
 * uploads a full-length marks array rather than sizing it with a define.
 */
function textMaterial(source: Material, marks: TextMark[]): ShaderMaterial {
  if (marks.length > marksPerMaterial) throw new Error(`a material carries more than ${marksPerMaterial} text marks`);
  const rectangles = marks.map(({ uv }) => new Vector4(...uv));
  while (rectangles.length < marksPerMaterial) rectangles.push(noMark);
  return new ShaderMaterial({
    side: source.side,
    uniforms: { marks: { value: rectangles } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec4 marks[${marksPerMaterial}];
      void main() {
        float text = 0.0;
        for (int i = 0; i < ${marksPerMaterial}; i++) {
          if (all(greaterThanEqual(vUv, marks[i].xy)) && all(lessThanEqual(vUv, marks[i].zw))) text = 1.0;
        }
        gl_FragColor = vec4(vec3(text), 1.0);
      }`,
  });
}

/** A copy of the model drawn in `look`; the source model is left as it is. */
export function lookOf({ scene, materialIndex }: SourceModel, look: Look, textMarks: TextMark[] = []): Object3D {
  const copy = scene.clone();
  copy.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const swap = (source: Material): Material => {
      if (look === 'silhouette') return new MeshBasicMaterial({ color: silhouetteColour, side: source.side });
      if (look === 'clay') return new MeshStandardMaterial({ color: clayColour, side: source.side });
      if (look === 'text') {
        const index = materialIndex.get(source);
        return textMaterial(source, textMarks.filter(({ material }) => material === index));
      }
      return source;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return look === 'surface' || look === 'clay' ? normalizeModel(copy) : copy;
}

/** The scene's bounding sphere, which sets a Stage Camera's near and far planes. */
export const boundsOf = (scene: Object3D) => new Box3().setFromObject(scene).getBoundingSphere(new Sphere());

/** The three.js camera a Stage Camera describes: square frame, Y up, near and far planes fitted to the model. */
export function cameraOf({ position, target, fov }: StageCamera, bounds: Sphere): PerspectiveCamera {
  const camera = new PerspectiveCamera(fov, 1);
  camera.position.set(...position);
  camera.lookAt(new Vector3(...target));
  const distance = camera.position.distanceTo(bounds.center);
  camera.near = Math.max(1e-4, distance / 100);
  camera.far = distance + 2 * bounds.radius;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/** A WebGL renderer drawing square Reveal Stage frames, transparent where background shows. */
export function stageRenderer(canvas: HTMLCanvasElement, pixelRatio = 1): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/** Draw `object` from `stageCamera` into the renderer's canvas at `size` pixels square. */
export function drawFrame(renderer: WebGLRenderer, object: Object3D, stageCamera: StageCamera, bounds: Sphere, size: number) {
  renderer.setSize(size, size, false);
  const scene = new Scene().add(object);
  renderer.render(scene, cameraOf(stageCamera, bounds));
  scene.remove(object);
}

function readPixels(renderer: WebGLRenderer): Uint8Array {
  const gl = renderer.getContext();
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** Whether any pixel of the canvas just drawn shows background (is not fully opaque). */
export function framesBackground(renderer: WebGLRenderer): boolean {
  const pixels = readPixels(renderer);
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) return true;
  return false;
}

/** Whether any pixel of a 'text' look just drawn shows marked text. */
export function framesText(renderer: WebGLRenderer): boolean {
  const pixels = readPixels(renderer);
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 0) return true;
  return false;
}

/**
 * Why `stageCamera` cannot be Reveal Stage `revealStage`'s, checked at `size`
 * pixels square: a stage-1 frame must lie wholly inside the object's outline
 * (ADR-0006), and no stage-1 or stage-3 frame may show marked text. Stage 2 is
 * a flat silhouette, which shows no text whatever its Stage Camera frames.
 */
export function stageCameraProblems(
  renderer: WebGLRenderer,
  model: SourceModel,
  revealStage: number,
  stageCamera: StageCamera,
  textMarks: TextMark[],
  size = stageImageSize,
): string[] {
  const problems: string[] = [];
  const bounds = boundsOf(model.scene);
  if (revealStage === 1) {
    drawFrame(renderer, lookOf(model, 'surface'), stageCamera, bounds, size);
    if (framesBackground(renderer)) problems.push('frames background, which shows the outline before Reveal Stage 2');
  }
  if ((revealStage === 1 || revealStage === 3) && textMarks.length > 0) {
    drawFrame(renderer, lookOf(model, 'text', textMarks), stageCamera, bounds, size);
    if (framesText(renderer)) problems.push('frames marked text');
  }
  return problems;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`the canvas could not be encoded as ${type}`))), type, quality),
  );

/** Reveal Stage `revealStage` (1-5) as its asset: a 1024×1024 lossless WebP without metadata. */
export async function stageImage(
  renderer: WebGLRenderer,
  model: SourceModel,
  revealStage: number,
  stageCamera: StageCamera,
): Promise<Uint8Array> {
  drawFrame(renderer, lookOf(model, stageLook(revealStage)), stageCamera, boundsOf(model.scene), stageImageSize);
  const blob = await toBlob(renderer.domElement, 'image/webp', 1);
  return simpleLosslessWebp(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Reveal Stage 6's asset: the model re-encoded as binary glTF with its source
 * materials, so the client draws it through the shader as it draws Ghosts,
 * carrying the stage-5 Stage Camera as a glTF camera to start free orbit from,
 * with every name, extras and the generator stripped (ADR-0006).
 */
export async function stageModel(model: SourceModel, stage5Camera: StageCamera): Promise<Uint8Array> {
  const scene = new Scene().add(model.scene.clone(), cameraOf(stage5Camera, boundsOf(model.scene)));
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true, trs: true })) as ArrayBuffer;
  return scrubbedGlb(new Uint8Array(glb));
}

/** Rendered assets of all six Reveal Stages, or why the Stage Cameras cannot be used. */
export async function renderRevealStages(
  renderer: WebGLRenderer,
  model: SourceModel,
  stageCameras: StageCamera[],
  textMarks: TextMark[],
): Promise<{ problems: string[]; images: Uint8Array[]; model: Uint8Array }> {
  const problems = stageCameras.flatMap((camera, index) =>
    stageCameraProblems(renderer, model, index + 1, camera, textMarks).map(
      (problem) => `Reveal Stage ${index + 1} Stage Camera ${problem}`,
    ),
  );
  if (problems.length > 0) return { problems, images: [], model: new Uint8Array() };
  const images: Uint8Array[] = [];
  for (const [index, camera] of stageCameras.entries()) images.push(await stageImage(renderer, model, index + 1, camera));
  return { problems, images, model: await stageModel(model, stageCameras[4]) };
}
