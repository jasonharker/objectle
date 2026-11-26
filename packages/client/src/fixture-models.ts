// Stand-in models for checking the normalization shader by eye until the
// stage asset format is decided (#5). Real-world scale, in metres.
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';

/** A terracotta teapot about 25 cm across. */
export function teapot(): Mesh {
  return new Mesh(new TeapotGeometry(0.08), new MeshStandardMaterial({ color: 0xc8643c }));
}

/** Near-black binoculars about 12 cm wide, to show the black floor. */
export function binoculars(): Group {
  const material = new MeshStandardMaterial({ color: 0x0b0b0c });
  const binoculars = new Group();
  for (const side of [-1, 1]) {
    const barrel = new Mesh(new CylinderGeometry(0.025, 0.025, 0.11, 32), material);
    const eyepiece = new Mesh(new CylinderGeometry(0.016, 0.016, 0.04, 32), material);
    barrel.rotation.x = eyepiece.rotation.x = Math.PI / 2;
    barrel.position.set(side * 0.035, 0, 0);
    eyepiece.position.set(side * 0.035, 0, -0.07);
    binoculars.add(barrel, eyepiece);
  }
  binoculars.add(new Mesh(new BoxGeometry(0.05, 0.012, 0.05), material));
  binoculars.rotation.y = -0.6;
  return binoculars;
}
