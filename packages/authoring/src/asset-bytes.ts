// Byte-level finishing of rendered Reveal Stage assets into the ADR-0006
// format (checked by @objectle/shared/stage-assets). Runs in the browser, so
// it works on Uint8Arrays, not Buffers.

const latin1 = (bytes: Uint8Array, start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The lossless image of a WebP file, alone in the simple format. Chromium
 * encodes a canvas at quality 1 as lossless VP8L but wraps it in the extended
 * format with an sRGB ICC profile; the pixels are sRGB already, so dropping
 * the profile changes nothing, and the result carries no metadata.
 */
export function simpleLosslessWebp(webp: Uint8Array): Uint8Array {
  if (latin1(webp, 0) !== 'RIFF' || latin1(webp, 8) !== 'WEBP') throw new Error('the encoder did not write a WebP');
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  for (let offset = 12; offset + 8 <= webp.length; ) {
    const length = view.getUint32(offset + 4, true);
    if (latin1(webp, offset) === 'VP8L') {
      const chunk = webp.subarray(offset, offset + 8 + length + (length % 2));
      return concat([ascii('RIFF'), uint32(4 + chunk.length), ascii('WEBP'), chunk]);
    }
    offset += 8 + length + (length % 2);
  }
  throw new Error('the encoder did not write a lossless WebP');
}

/** Drop every name and extras, and the asset's generator and copyright, from glTF JSON. */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'name' && key !== 'extras')
      .map(([key, child]) => [key, scrub(child)]),
  );
}

/** A binary glTF with no names, extras, generator or copyright: nothing in it can name the noun. */
export function scrubbedGlb(glb: Uint8Array): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  delete json.asset.generator;
  delete json.asset.copyright;
  const text = new TextEncoder().encode(JSON.stringify(scrub(json)));
  const padded = concat([text, new Uint8Array((4 - (text.length % 4)) % 4).fill(0x20)]);
  const rest = glb.subarray(20 + jsonLength);
  return concat([
    uint32(0x46546c67),
    uint32(2),
    uint32(12 + 8 + padded.length + rest.length),
    uint32(padded.length),
    uint32(0x4e4f534a),
    padded,
    rest,
  ]);
}
