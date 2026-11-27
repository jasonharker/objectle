// The curation data the stage-authoring tool records per Answer Pool object,
// shared by the browser tool and the Node side that writes it.

type Vector = [number, number, number];

/**
 * A Stage Camera, in the coordinates of the noun's model file (metres): a
 * perspective camera at `position` looking at `target`, with Y up, a square
 * frame and a vertical field of view of `fov` degrees.
 */
export interface StageCamera {
  position: Vector;
  target: Vector;
  fov: number;
}

/**
 * Where a model carries readable text: the part of material `material` (its
 * index in the model's glTF) whose texture coordinates fall inside `uv`,
 * [uMin, vMin, uMax, vMax]. [0, 0, 1, 1] marks the whole material.
 */
export interface TextMark {
  material: number;
  uv: [number, number, number, number];
}

const isNumbers = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every((x) => typeof x === 'number' && Number.isFinite(x));

export function isStageCamera(value: unknown): value is StageCamera {
  if (typeof value !== 'object' || value === null) return false;
  const { position, target, fov } = value as Record<string, unknown>;
  return (
    isNumbers(position, 3) &&
    isNumbers(target, 3) &&
    position.some((x, axis) => x !== target[axis]) &&
    typeof fov === 'number' &&
    fov > 0 &&
    fov < 180
  );
}

export function isTextMark(value: unknown): value is TextMark {
  if (typeof value !== 'object' || value === null) return false;
  const { material, uv } = value as Record<string, unknown>;
  return Number.isInteger(material) && (material as number) >= 0 && isNumbers(uv, 4) && uv[0] <= uv[2] && uv[1] <= uv[3];
}
