// The stylized normalization shader (ADR-0002). Every model in the game client
// and the stage-authoring tool is drawn through this module, so both see the
// same look whatever the model's source.
import {
  Color,
  Data3DTexture,
  NearestFilter,
  ShaderMaterial,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';

/** An sRGB colour, each channel in [0, 1]. */
export type Rgb = [number, number, number];

/**
 * The shared palette definition. `depth` (levels per hue) and `blackFloor`
 * (brightness of the darkest level) are the two tuning settings; change them
 * here and every consumer of the shader follows.
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

const quantize = (x: number, steps: number) => Math.round(x * (steps - 1)) / (steps - 1);

/**
 * The palette colour a base colour is quantized to: hue and saturation snap
 * to the palette's steps, and brightness to the nearest of `depth` levels
 * spaced evenly from the black floor up to full brightness.
 */
export function paletteColor([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  let hue = 0;
  if (chroma > 0) {
    if (max === r) hue = ((g - b) / chroma + 6) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
  }
  const { depth, blackFloor, hues, saturations } = palette;
  const h = (Math.round((hue / 6) * hues) % hues) / hues;
  const s = quantize(max === 0 ? 0 : chroma / max, saturations);
  const level = Math.min(depth - 1, Math.max(0, Math.round(((max - blackFloor) / (1 - blackFloor)) * (depth - 1))));
  const v = blackFloor + ((1 - blackFloor) * level) / (depth - 1);
  return hsvToRgb(h, s, v);
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const channel = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [channel(5), channel(3), channel(1)];
}

/** Cells per side of the palette lookup table the shader samples. */
const lutSize = 32;
let paletteLut: Data3DTexture | undefined;

/**
 * The palette as a 3D lookup table from sRGB base colour to palette colour,
 * built from `paletteColor`, so the GPU applies exactly the rule above.
 */
function paletteTexture(): Data3DTexture {
  if (paletteLut) return paletteLut;
  const data = new Uint8Array(4 * lutSize ** 3);
  const centre = (i: number) => (i + 0.5) / lutSize;
  for (let b = 0, o = 0; b < lutSize; b++) {
    for (let g = 0; g < lutSize; g++) {
      for (let r = 0; r < lutSize; r++, o += 4) {
        const colour = paletteColor([centre(r), centre(g), centre(b)]);
        data.set([...colour.map((x) => Math.round(x * 255)), 255], o);
      }
    }
  }
  paletteLut = new Data3DTexture(data, lutSize, lutSize, lutSize);
  paletteLut.minFilter = paletteLut.magFilter = NearestFilter;
  paletteLut.unpackAlignment = 1;
  paletteLut.needsUpdate = true;
  return paletteLut;
}

const vertexShader = /* glsl */ `
varying vec3 vViewNormal;
varying vec2 vUv;

void main() {
  vUv = uv;
  vViewNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp sampler3D;

uniform vec3 baseColor;
uniform sampler2D map;
uniform sampler3D palette;
varying vec3 vViewNormal;
varying vec2 vUv;

// The one fixed lighting rig, in view space so every Stage Camera lights a
// model the same way: a key light from the upper left, a weak fill from the
// right, and an ambient term that keeps shadowed sides off black.
const vec3 keyLight = vec3(-0.45, 0.6, 0.66);
const vec3 fillLight = vec3(0.8, -0.1, 0.59);
const float ambient = 0.45;

// Soft toon shading: two softened steps give shadow, mid and lit bands.
float toon(float lambert) {
  return 0.5 * smoothstep(0.0, 0.08, lambert) + 0.5 * smoothstep(0.5, 0.58, lambert);
}

void main() {
  vec3 base = baseColor;
  #ifdef USE_BASE_MAP
    base *= texture2D(map, vUv).rgb;
  #endif
  vec3 srgb = sRGBTransferOETF(vec4(base, 1.0)).rgb;
  vec3 quantized = sRGBTransferEOTF(texture(palette, srgb)).rgb;

  vec3 n = normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float light = ambient + 0.45 * toon(dot(n, keyLight)) + 0.15 * toon(dot(n, fillLight));
  gl_FragColor = vec4(quantized * light, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * The normalization material for one source material: it keeps only the
 * base colour and colour map; everything else, including baked lighting
 * (light, AO and emissive maps), is discarded.
 */
function normalizationMaterial(source: Material): ShaderMaterial {
  const { color, map } = source as Partial<MeshStandardMaterial>;
  return new ShaderMaterial({
    name: 'objectle-normalization',
    side: source.side,
    defines: map ? { USE_BASE_MAP: '' } : {},
    uniforms: {
      baseColor: { value: color ? color.clone() : new Color(1, 1, 1) },
      map: { value: (map ?? null) as Texture | null },
      palette: { value: paletteTexture() },
    },
    vertexShader,
    fragmentShader,
  });
}

/** Draw every mesh under `root` through the normalization shader, in place. */
export function normalizeModel<T extends Object3D>(root: T): T {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(normalizationMaterial)
      : normalizationMaterial(mesh.material);
  });
  return root;
}
