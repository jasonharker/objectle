// The format a Reveal Stage asset must have before the API serves it
// (ADR-0006): stages 1-5 are 1024×1024 lossless WebP images with no metadata,
// stage 6 is a self-contained binary glTF with no names, extras or generator.
// Neither format then carries anything beyond the pixels or the geometry, so
// no payload can name the noun. Whether the pixels disclose too much (a stage-1
// crop framing background) is the curation build's check, not this one.

/** Every Reveal Stage image is this many pixels square, so its size says nothing about the object. */
export const stageImageSize = 1024;

const imageStages = 5;

/** Why `bytes` cannot be served as an asset of a Reveal Stage; empty if they can. */
export function stageAssetProblems(revealStage: number, bytes: Buffer): string[] {
  return revealStage <= imageStages ? imageProblems(bytes) : modelProblems(bytes);
}

/**
 * A simple-format lossless WebP is a RIFF file holding exactly one VP8L
 * chunk: lossy images use a VP8 chunk, and metadata (EXIF, XMP, ICC) needs
 * the extended format's VP8X chunk or chunks after the image.
 */
function imageProblems(bytes: Buffer): string[] {
  const text = (start: number) => bytes.toString('latin1', start, start + 4);
  if (bytes.length < 25 || text(0) !== 'RIFF' || text(8) !== 'WEBP') return ['is not a WebP image'];
  if (text(12) !== 'VP8L' || bytes[20] !== 0x2f) {
    return ['is not a lossless WebP in the simple format, which carries no metadata'];
  }
  const chunkEnd = 20 + bytes.readUInt32LE(16) + (bytes.readUInt32LE(16) % 2);
  if (bytes.readUInt32LE(4) !== bytes.length - 8 || chunkEnd !== bytes.length) {
    return ['carries data besides its image'];
  }
  const bits = bytes.readUInt32LE(21);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  if (width !== stageImageSize || height !== stageImageSize) {
    return [`is ${width}×${height}, not ${stageImageSize}×${stageImageSize}`];
  }
  return [];
}

const glbMagic = 0x46546c67;
const jsonChunk = 0x4e4f534a;
const binChunk = 0x004e4942;

/** A binary glTF holding a JSON chunk and at most a binary one, whose JSON names nothing. */
function modelProblems(bytes: Buffer): string[] {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== glbMagic || bytes.readUInt32LE(4) !== 2) {
    return ['is not a binary glTF 2.0 model'];
  }
  if (bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== jsonChunk) {
    return ['is not a well-formed binary glTF'];
  }
  const jsonEnd = 20 + bytes.readUInt32LE(12);
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8', 20, jsonEnd));
  } catch {
    return ['is not a well-formed binary glTF'];
  }
  const problems = new Set<string>();
  if (jsonEnd !== bytes.length) {
    const binEnd = jsonEnd + 8 <= bytes.length ? jsonEnd + 8 + bytes.readUInt32LE(jsonEnd) : -1;
    if (binEnd !== bytes.length || bytes.readUInt32LE(jsonEnd + 4) !== binChunk) {
      problems.add('carries chunks besides its JSON and binary data');
    }
  }
  const asset = (json as { asset?: Record<string, unknown> }).asset ?? {};
  if ('generator' in asset) problems.add('names its generator');
  if ('copyright' in asset) problems.add('carries a copyright notice');
  const visit = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'name') problems.add('carries a name');
      if (key === 'extras') problems.add('carries extras');
      if (key === 'uri') problems.add('refers to another file');
      visit(child);
    }
  };
  visit(json);
  return [...problems];
}
