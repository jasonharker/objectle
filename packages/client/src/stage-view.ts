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
 */
export function hiddenDailyObject(): Object3D {
  return new Mesh(new SphereGeometry(0.5, 32, 16), new MeshStandardMaterial({ color: 0x8a8d99 }));
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

  const bounds = new Box3().setFromObject(scene).getBoundingSphere(new Sphere());
  const camera = new PerspectiveCamera(30, 1, 0.01, 100);
  const distance = bounds.radius / Math.sin((camera.fov * Math.PI) / 360);
  camera.position.copy(bounds.center).add(new Vector3(0, 0.45, 1).setLength(distance));
  camera.lookAt(bounds.center);
  let target = bounds.center;
  const carried = orbit ? (model.getObjectByProperty('isCamera', true) as Camera | undefined) : undefined;
  if (carried) {
    scene.updateMatrixWorld();
    carried.matrixWorld.decompose(camera.position, camera.quaternion, new Vector3());
    if (carried instanceof PerspectiveCamera) camera.fov = carried.fov;
    // Orbit about the point straight ahead as far away as the model's centre, so the first frame is the carried view.
    const ahead = camera.getWorldDirection(new Vector3()).multiplyScalar(camera.position.distanceTo(bounds.center));
    target = camera.position.clone().add(ahead);
  }

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x3a3d52);
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
