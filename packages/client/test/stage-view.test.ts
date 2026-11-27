// The stage view's camera seam: Reveal Stage 6 starts free orbit from the
// stage-5 Stage Camera its model carries (ADR-0006), so its first frame is the
// stage-5 view, clipping planes included.
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { expect, test } from 'vitest';
import { stageCamera } from '../src/stage-view.ts';

/** A 10 cm box carrying a camera 40 cm in front of it, with clipping planes fitted to it as a Stage Camera's are. */
function modelWithCamera(): Group {
  const carried = new PerspectiveCamera(25, 1, 0.004, 0.52);
  carried.position.set(0, 0, 0.4);
  return new Group().add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial()), carried);
}

test('starts from the carried camera’s view, clipping planes included', () => {
  const model = modelWithCamera();
  const { camera } = stageCamera(new Scene().add(model), model, true);
  expect(camera.fov).toBe(25);
  expect(camera.near).toBeCloseTo(0.004, 5);
  expect(camera.far).toBeCloseTo(0.52, 5);
});

test('keeps the carried clipping planes at the same place in the view when the model is scaled', () => {
  const model = modelWithCamera();
  model.scale.setScalar(2);
  const { camera } = stageCamera(new Scene().add(model), model, true);
  expect(camera.position.z).toBeCloseTo(0.8, 5);
  expect(camera.near).toBeCloseTo(0.008, 5);
  expect(camera.far).toBeCloseTo(1.04, 5);
});
