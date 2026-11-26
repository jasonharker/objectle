import { Box3, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer, type Object3D } from 'three';
import { normalizeModel } from '@objectle/shared/shader';

/**
 * Draw a model and its Ghosts through the normalization shader. Models are at
 * real-world scale, so placing them side by side unscaled shows the Ghosts at
 * true relative scale.
 */
export function drawStage(canvas: HTMLCanvasElement, model: Object3D, ghosts: Object3D[] = []): void {
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

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x3a3d52);
  const render = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  new ResizeObserver(render).observe(canvas);
}
