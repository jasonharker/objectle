import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { normalizeModel } from '@objectle/shared/shader';

let swatch: CanvasRenderingContext2D | undefined;

/**
 * A colour token of style.css, read from the page, as the 0xRRGGBB sRGB three.js
 * takes. The browser resolves it, painted on a 1×1 sRGB canvas, since the built
 * CSS may hold the token as hex or lab() rather than as written.
 */
function tokenColour(name: string): number {
  swatch ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
  swatch.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name);
  swatch.fillRect(0, 0, 1, 1);
  const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data;
  return (r << 16) | (g << 8) | b;
}

/** Scale a model so its longest dimension is `length`. */
export function scaleToLongestDimension(object: Object3D, length: number): Object3D {
  const size = new Box3().setFromObject(object).getSize(new Vector3());
  object.scale.multiplyScalar(length / Math.max(size.x, size.y, size.z));
  return object;
}

/**
 * What the Ghosts stand beside until the Daily Object's model is disclosed:
 * a plain grey ball, longest dimension 1, in the Daily Object's place. Ghosts
 * are scaled by their relative size, so the ball is the Daily Object's Size
 * and nothing else about it. From Reveal Stage 6, and at the game's end, the
 * stage-6 model scaled to longest dimension 1 takes its place (ADR-0006).
 * Its colour is style.css's `--color-hidden-object` unless `color` is given.
 */
export function hiddenDailyObject(color = tokenColour('--color-hidden-object')): Object3D {
  return new Mesh(new SphereGeometry(0.5, 32, 16), new MeshStandardMaterial({ color }));
}

/**
 * The camera `scene` is first drawn from, and the point orbit turns about:
 * with `orbit`, the camera `model` carries, if any, else one framing the
 * whole scene.
 */
export function stageCamera(scene: Object3D, model: Object3D, orbit: boolean): { camera: PerspectiveCamera; target: Vector3 } {
  const bounds = new Box3().setFromObject(scene).getBoundingSphere(new Sphere());
  const camera = new PerspectiveCamera(30, 1, 0.01, 100);
  const distance = bounds.radius / Math.sin((camera.fov * Math.PI) / 360);
  camera.position.copy(bounds.center).add(new Vector3(0, 0.45, 1).setLength(distance));
  camera.lookAt(bounds.center);
  let target = bounds.center;
  const carried = orbit ? (model.getObjectByProperty('isCamera', true) as Camera | undefined) : undefined;
  if (carried) {
    scene.updateMatrixWorld();
    const scale = new Vector3();
    carried.matrixWorld.decompose(camera.position, camera.quaternion, scale);
    if (carried instanceof PerspectiveCamera) {
      // Its clipping planes too, in world units, so the first frame clips where the stage-5 image did.
      camera.fov = carried.fov;
      camera.near = carried.near * scale.z;
      camera.far = carried.far * scale.z;
    }
    // Orbit about the point straight ahead as far away as the model's centre, so the first frame is the carried view.
    const ahead = camera.getWorldDirection(new Vector3()).multiplyScalar(camera.position.distanceTo(bounds.center));
    target = camera.position.clone().add(ahead);
  }
  return { camera, target };
}

/**
 * Draw a model and its Ghosts through the normalization shader. Models are at
 * real-world scale, so placing them side by side unscaled shows the Ghosts at
 * true relative scale. With `orbit`, the player can orbit the model freely by
 * mouse or touch, starting from the camera the model carries (Reveal Stage 6
 * carries the stage-5 Stage Camera), if any. Returns a function that stops
 * redrawing and releases the canvas's WebGL context; call it before replacing
 * the drawing.
 */
export function drawStage(
  canvas: HTMLCanvasElement,
  model: Object3D,
  ghosts: Object3D[] = [],
  { orbit = false } = {},
): () => void {
  const scene = new Scene();
  let x = 0;
  for (const object of [model, ...ghosts]) {
    normalizeModel(object);
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    // Stand each model on the ground, next to the previous one.
    object.position.add(new Vector3(x - box.min.x, -box.min.y, -(box.min.z + box.max.z) / 2));
    x += size.x + 0.05;
    scene.add(object);
  }

  const { camera, target } = stageCamera(scene, model, orbit);

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  // The page's own stage colour, so the canvas matches a Reveal Stage image's backdrop.
  renderer.setClearColor(tokenColour('--color-stage'));
  const render = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(render);
  observer.observe(canvas);
  const controls = orbit ? new OrbitControls(camera, canvas) : undefined;
  if (controls) {
    controls.target.copy(target);
    controls.enablePan = false;
    controls.update();
    controls.addEventListener('change', render);
  }
  return () => {
    controls?.dispose();
    observer.disconnect();
    renderer.dispose();
    // Browsers cap live WebGL contexts; dispose() alone keeps this one until GC.
    renderer.forceContextLoss();
  };
}
