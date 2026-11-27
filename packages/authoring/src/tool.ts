// The stage-authoring tool's page: the curator picks an Answer Pool object,
// frames a Stage Camera for each of Reveal Stages 1-5 in a live view drawn
// exactly as that stage is rendered, marks where the model carries text,
// previews every stage in the player's layout, records the Difficulty Rating
// and saves. Terms follow GLOSSARY.md.
import { PerspectiveCamera, Raycaster, Vector2, Vector3, type Mesh, type Object3D } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DifficultyRating } from '@objectle/shared';
import type { AuthoredObject, AuthoringContent } from './content-store.ts';
import type { PreviewStage } from './preview-page.ts';
import { isStageCamera, type StageCamera, type TextMark } from './stage-camera.ts';
import {
  boundsOf,
  cameraOf,
  drawFrame,
  lookOf,
  renderRevealStages,
  stageCameraProblems,
  stageImage,
  stageLook,
  stageModel,
  stageRenderer,
  type Look,
  type SourceModel,
} from './stage-render.ts';
import { fetchModel, saveObject } from './tool-api.ts';

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const nounSelect = $<HTMLSelectElement>('#noun');
const difficulty = $<HTMLSelectElement>('#difficulty');
const saveButton = $<HTMLButtonElement>('#save');
const modelStatus = $('#model-status');
const view = $<HTMLCanvasElement>('#view');
const viewFrame = $<HTMLElement>('#view-frame');
const markBox = $<HTMLElement>('#mark-box');
const liveWarning = $('#live-warning');
const fields = { position: $<HTMLInputElement>('#position'), target: $<HTMLInputElement>('#target'), fov: $<HTMLInputElement>('#fov') };
const markButton = $<HTMLButtonElement>('#mark-text');
const showMarks = $<HTMLInputElement>('#show-marks');
const markCount = $('#mark-count');
const summary = $('#stage-summary');
const player = $<HTMLIFrameElement>('#player');
const saveStatus = $('#save-status');

/** Live checks draw this many pixels square: quick enough to follow the camera; saving checks at full size. */
const liveCheckSize = 256;
const stages = [1, 2, 3, 4, 5, 6];

let content: AuthoringContent = { guessVocabulary: [], authored: [] };
let model: SourceModel | undefined;
let looks: Record<Look, Object3D> | undefined;
let noun = '';
let revealStage = 1;
let stageCameras: (StageCamera | undefined)[] = [];
let textMarks: TextMark[] = [];
/** Object URLs of the previewed stages' assets, until something changes them. */
let previewUrls: string[] | undefined;

const liveRenderer = stageRenderer(view, window.devicePixelRatio);
/** Checks, previews and saves draw off-screen, at the size each needs. */
const offscreen = stageRenderer(document.createElement('canvas'));
const orbitCamera = new PerspectiveCamera(30, 1, 0.001, 100);
const controls = new OrbitControls(orbitCamera, view);

// Stage choice.
const stageList = $('#stages');
for (const stage of stages) {
  const label = document.createElement('label');
  const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'stage', value: String(stage), checked: stage === 1 });
  input.addEventListener('change', () => chooseStage(stage));
  label.append(input, ` Reveal Stage ${stage}`);
  stageList.append(label);
}

const round = (x: number) => Number(x.toFixed(5));
const formatVector = (v: number[]) => v.map(round).join(', ');
const parseVector = (text: string) => {
  const v = text.split(',').map((part) => Number(part.trim()));
  return v.length === 3 && v.every(Number.isFinite) ? (v as [number, number, number]) : undefined;
};

/** The view the fields describe: the camera "Use this view" records, and the one the live view draws from. */
function currentView(): StageCamera | undefined {
  const camera = { position: parseVector(fields.position.value), target: parseVector(fields.target.value), fov: Number(fields.fov.value) };
  return isStageCamera(camera) ? camera : undefined;
}

let applyingFields = false;
function showView(camera: StageCamera) {
  fields.position.value = formatVector(camera.position);
  fields.target.value = formatVector(camera.target);
  fields.fov.value = String(round(camera.fov));
  applyFields();
}

function applyFields() {
  const camera = currentView();
  if (camera === undefined) return;
  applyingFields = true;
  orbitCamera.position.set(...camera.position);
  orbitCamera.fov = camera.fov;
  orbitCamera.updateProjectionMatrix();
  controls.target.set(...camera.target);
  controls.update();
  applyingFields = false;
  redraw();
}

controls.addEventListener('change', () => {
  if (applyingFields) return;
  fields.position.value = formatVector(orbitCamera.position.toArray());
  fields.target.value = formatVector(controls.target.toArray());
  fields.fov.value = String(round(orbitCamera.fov));
  redraw();
});
$('#camera-fields').addEventListener('input', applyFields);
$('#camera-fields').addEventListener('submit', (event) => {
  event.preventDefault();
  applyFields();
});

/** A view of the whole model from the front and a little above, as the game frames a model. */
function defaultView(): StageCamera {
  const bounds = boundsOf(model!.scene);
  const fov = 30;
  const position = bounds.center.clone().add(new Vector3(0, 0.45, 1).setLength(bounds.radius / Math.sin((fov * Math.PI) / 360)));
  return { position: position.toArray(), target: bounds.center.toArray(), fov };
}

/** The Stage Camera Reveal Stage `stage` is seen from: its own, or for stage 6 the stage-5 one. */
const stageCameraOf = (stage: number) => stageCameras[Math.min(stage, 5) - 1];

function chooseStage(stage: number) {
  revealStage = stage;
  $<HTMLButtonElement>('#use-view').disabled = stage === 6;
  const camera = stageCameraOf(stage);
  if (model !== undefined && camera !== undefined) showView(camera);
  redraw();
  showPreview();
}

let frameRequested = false;
/** Redraw the live view and its warnings on the next frame. */
function redraw() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    const camera = currentView();
    if (model === undefined || looks === undefined || camera === undefined) return;
    const look = showMarks.checked ? 'text' : revealStage === 6 ? 'surface' : stageLook(revealStage);
    drawFrame(liveRenderer, looks[look], camera, boundsOf(model.scene), view.clientWidth);
    const problems = revealStage === 6 ? [] : stageCameraProblems(offscreen, model, revealStage, camera, textMarks, liveCheckSize);
    liveWarning.replaceChildren(...problems.map((problem) => line(`Reveal Stage ${revealStage}: this view ${problem}`)));
  });
}

const line = (text: string, tag = 'div') => Object.assign(document.createElement(tag), { textContent: text });

/** Something that changes the rendered stages: the preview is stale, the summary is rechecked. */
function changed() {
  if (previewUrls) previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = undefined;
  markCount.textContent = `${textMarks.length} text mark${textMarks.length === 1 ? '' : 's'}`;
  summary.replaceChildren(
    ...stageCameras.map((camera, index) => {
      const stage = index + 1;
      if (camera === undefined) return line(`Reveal Stage ${stage}: no Stage Camera yet`, 'li');
      const problems = model ? stageCameraProblems(offscreen, model, stage, camera, textMarks, liveCheckSize) : [];
      return line(`Reveal Stage ${stage}: Stage Camera set${problems.map((problem) => `; it ${problem}`).join('')}`, 'li');
    }),
  );
  redraw();
}

$('#use-view').addEventListener('click', () => {
  const camera = currentView();
  if (camera === undefined || revealStage === 6) return;
  stageCameras[revealStage - 1] = camera;
  changed();
});
$('#go-to').addEventListener('click', () => {
  const camera = stageCameraOf(revealStage);
  if (camera !== undefined) showView(camera);
});
showMarks.addEventListener('change', redraw);
$('#clear-marks').addEventListener('click', () => {
  textMarks = [];
  rebuildLooks();
  changed();
});

function rebuildLooks() {
  if (model === undefined) return;
  looks = {
    surface: lookOf(model, 'surface'),
    silhouette: lookOf(model, 'silhouette'),
    clay: lookOf(model, 'clay'),
    text: lookOf(model, 'text', textMarks),
  };
}

// Marking text: drag a rectangle over it; every surface point under the rectangle is marked by its material's UVs.
let markStart: Vector2 | undefined;
markButton.addEventListener('click', () => setMarking(markButton.getAttribute('aria-pressed') !== 'true'));
function setMarking(on: boolean) {
  markButton.setAttribute('aria-pressed', String(on));
  viewFrame.classList.toggle('marking', on);
  controls.enabled = !on;
}
const pointerAt = (event: PointerEvent) => {
  const rect = view.getBoundingClientRect();
  return new Vector2(event.clientX - rect.left, event.clientY - rect.top);
};
view.addEventListener('pointerdown', (event) => {
  if (!viewFrame.classList.contains('marking')) return;
  markStart = pointerAt(event);
  view.setPointerCapture(event.pointerId);
});
view.addEventListener('pointermove', (event) => {
  if (markStart === undefined) return;
  const end = pointerAt(event);
  Object.assign(markBox.style, {
    left: `${Math.min(markStart.x, end.x)}px`,
    top: `${Math.min(markStart.y, end.y)}px`,
    width: `${Math.abs(end.x - markStart.x)}px`,
    height: `${Math.abs(end.y - markStart.y)}px`,
  });
  markBox.hidden = false;
});
view.addEventListener('pointerup', (event) => {
  if (markStart === undefined) return;
  const [start, end] = [markStart, pointerAt(event)];
  markStart = undefined;
  markBox.hidden = true;
  setMarking(false);
  const marks = marksUnder(start, end);
  if (marks.length === 0) return;
  textMarks = [...textMarks, ...marks];
  rebuildLooks();
  changed();
});

/** One text mark per material under the view rectangle from `a` to `b` (CSS pixels): the bounds of the UVs hit. */
function marksUnder(a: Vector2, b: Vector2): TextMark[] {
  const camera = currentView();
  if (model === undefined || camera === undefined) return [];
  model.scene.updateMatrixWorld();
  const raycaster = new Raycaster();
  const three = cameraOf(camera, boundsOf(model.scene));
  const bounds = new Map<number, [number, number, number, number]>();
  const samples = 24;
  for (let i = 0; i <= samples; i++) {
    for (let j = 0; j <= samples; j++) {
      const x = a.x + ((b.x - a.x) * i) / samples;
      const y = a.y + ((b.y - a.y) * j) / samples;
      raycaster.setFromCamera(new Vector2((x / view.clientWidth) * 2 - 1, 1 - (y / view.clientHeight) * 2), three);
      const [hit] = raycaster.intersectObject(model.scene, true);
      if (hit?.uv === undefined) continue;
      const material = (hit.object as Mesh).material;
      const index = model.materialIndex.get(Array.isArray(material) ? material[hit.face!.materialIndex] : material);
      if (index === undefined) continue;
      const [u0, v0, u1, v1] = bounds.get(index) ?? [Infinity, Infinity, -Infinity, -Infinity];
      bounds.set(index, [Math.min(u0, hit.uv.x), Math.min(v0, hit.uv.y), Math.max(u1, hit.uv.x), Math.max(v1, hit.uv.y)]);
    }
  }
  return [...bounds].map(([material, uv]) => ({ material, uv: uv.map(round) as TextMark['uv'] }));
}

// Preview and save.
const status = (...lines: string[]) => saveStatus.replaceChildren(...lines.map((text) => line(text, 'li')));

function missingCameras(): string[] {
  return stageCameras.flatMap((camera, index) => (camera === undefined ? [`Reveal Stage ${index + 1} has no Stage Camera yet`] : []));
}

$('#preview-button').addEventListener('click', async () => {
  if (model === undefined) return;
  const missing = missingCameras();
  if (missing.length > 0) return status(...missing);
  const cameras = stageCameras as StageCamera[];
  const images = [];
  for (const [index, camera] of cameras.entries()) images.push(await stageImage(offscreen, model, index + 1, camera));
  const assets = [...images.map((bytes) => new Blob([bytes as BlobPart], { type: 'image/webp' })), new Blob([(await stageModel(model, cameras[4])) as BlobPart], { type: 'model/gltf-binary' })];
  previewUrls = assets.map((blob) => URL.createObjectURL(blob));
  status('Previewing the rendered Reveal Stages; choose a stage to see it.');
  showPreview();
});

/** Show the chosen stage's previewed asset in the player's layout, once the preview page is ready. */
async function showPreview() {
  if (previewUrls === undefined) return;
  const frame = player.contentWindow as (Window & { showStage?: (stage: PreviewStage) => Promise<void> }) | null;
  if (typeof frame?.showStage !== 'function') {
    setTimeout(showPreview, 50);
    return;
  }
  await frame.showStage({
    revealStage,
    url: previewUrls[revealStage - 1],
    firstLetter: revealStage === 6 ? noun[0] : null,
  });
}

saveButton.addEventListener('click', async () => {
  if (model === undefined) return;
  const missing = missingCameras();
  if (missing.length > 0) return status(...missing);
  const object: AuthoredObject = {
    noun,
    difficultyRating: (difficulty.value || undefined) as DifficultyRating,
    stageCameras: stageCameras as AuthoredObject['stageCameras'],
    textMarks,
  };
  saveButton.disabled = true;
  status('Rendering and saving…');
  try {
    const rendered = await renderRevealStages(offscreen, model, object.stageCameras, textMarks);
    const problems = rendered.problems.length > 0 ? rendered.problems : await saveObject(object, rendered);
    if (problems.length > 0) return status(...problems);
    content.authored = [...content.authored.filter((authored) => authored.noun !== object.noun), object];
    status(`Saved ${object.noun}: its six Reveal Stages are written; run the curation build to publish them.`);
  } catch (error) {
    status(`Saving failed: ${(error as Error).message}`);
  } finally {
    saveButton.disabled = false;
  }
});

// Choosing the object.
nounSelect.addEventListener('change', async () => {
  const chosen = (noun = nounSelect.value);
  model = looks = undefined;
  saveButton.disabled = true;
  if (chosen === '') return;
  modelStatus.textContent = `Loading ${chosen}…`;
  try {
    const loaded = await fetchModel(chosen);
    if (chosen !== noun) return; // another noun was chosen meanwhile
    model = loaded;
  } catch (error) {
    if (chosen === noun) modelStatus.textContent = (error as Error).message;
    return;
  }
  const authored = content.authored.find((object) => object.noun === noun);
  stageCameras = authored ? [...authored.stageCameras] : [undefined, undefined, undefined, undefined, undefined];
  textMarks = authored ? [...authored.textMarks] : [];
  difficulty.value = authored?.difficultyRating ?? '';
  rebuildLooks();
  showView(stageCameraOf(revealStage) ?? defaultView());
  changed();
  saveButton.disabled = false;
  modelStatus.textContent = `Model loaded: ${noun}${authored ? ' (in the Answer Pool)' : ''}`;
});

content = await (await fetch('/authoring/content')).json();
const authoredNouns = new Set(content.authored.map((object) => object.noun));
nounSelect.append(
  ...content.guessVocabulary.map(({ name }) =>
    Object.assign(document.createElement('option'), { value: name, textContent: authoredNouns.has(name) ? `${name} (authored)` : name }),
  ),
);
new ResizeObserver(redraw).observe(view);
