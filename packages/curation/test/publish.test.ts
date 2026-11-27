// Seam 2 again: the publish commands of the curation command-line tool, which
// the content repo's publish pipeline runs (ADR-0008). Tests check only their
// exit status, what they print and the files they write.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';

const cli = fileURLToPath(new URL('../src/publish-cli.ts', import.meta.url));

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function publish(...args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) =>
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr }),
    );
  });
}

const tempDir = (prefix: string) => mkdtemp(join(tmpdir(), `objectle-${prefix}-`));

/** The objectle Deployment in the GitOps repo, trimmed to the lines the pipeline reads. */
function deployment({
  launchDate = '"2027-03-01"',
  contentImage = 'registry.example:5000/objectle-content:1a2b3c4d-7 # objectle-content-image',
}: { launchDate?: string; contentImage?: string } = {}): string {
  return [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'spec:',
    '  template:',
    '    spec:',
    '      containers:',
    '        - name: objectle',
    '          image: registry.example:5000/objectle:34e5cd5e # objectle-image',
    '          env:',
    '            - name: OBJECTLE_LAUNCH_DATE',
    `              value: ${launchDate}`,
    '            - name: OBJECTLE_CONTENT_DIR',
    '              value: /content',
    '      volumes:',
    '        - name: content',
    '          image:',
    ...(contentImage === '' ? [] : [`            reference: ${contentImage}`]),
    '',
  ].join('\n');
}

async function deploymentFile(options?: Parameters<typeof deployment>[0]): Promise<string> {
  const file = join(await tempDir('gitops'), 'deployment.yaml');
  await writeFile(file, deployment(options));
  return file;
}

describe('read-back', () => {
  test('prints the Launch Date and the deployed content image for the pipeline to source', async () => {
    const run = await publish('read-back', await deploymentFile());
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      'LAUNCH_DATE=2027-03-01\nCONTENT_IMAGE=registry.example:5000/objectle-content:1a2b3c4d-7\n',
    );
  });

  test.each(['2027-03-01', "'2027-03-01'"])('reads a Launch Date written as %s', async (launchDate) => {
    const run = await publish('read-back', await deploymentFile({ launchDate }));
    expect(run.stdout).toContain('LAUNCH_DATE=2027-03-01\n');
  });

  test.each([
    ['the marker is absent', ''],
    ['the tag is pending', 'registry.example:5000/objectle-content:pending # objectle-content-image'],
  ])('with no content image ever published (%s), the content image is empty', async (_, contentImage) => {
    const run = await publish('read-back', await deploymentFile({ contentImage }));
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('LAUNCH_DATE=2027-03-01\nCONTENT_IMAGE=\n');
  });

  test.each([
    ['no Launch Date', deployment().replace(/ *- name: OBJECTLE_LAUNCH_DATE\n.*\n/, ''), 'no OBJECTLE_LAUNCH_DATE'],
    ['a Launch Date that is not a date', deployment({ launchDate: '"2027-02-30"' }), 'not a YYYY-MM-DD date'],
    [
      'two content image markers',
      deployment().replace(/( *reference: .*\n)/, '$1$1'),
      'more than one content image marker',
    ],
    [
      'a content image reference that is not one',
      deployment({ contentImage: 'registry.example:5000/objectle-content:$(reboot) # objectle-content-image' }),
      'not an image reference',
    ],
  ])('fails on a Deployment with %s', async (_, yaml, problem) => {
    const file = join(await tempDir('gitops'), 'deployment.yaml');
    await writeFile(file, yaml);
    const run = await publish('read-back', file);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(problem);
    expect(run.stdout).toBe('');
  });

  test('fails on a missing Deployment file', async () => {
    const run = await publish('read-back', join(await tempDir('gitops'), 'deployment.yaml'));
    expect(run.status).toBe(1);
  });
});

/** A ustar archive of the given files, as a layer blob holds them. */
function tar(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name, 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write('0', 156);
    header.write('ustar\0' + '00', 257);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

const digest = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const ociManifest = 'application/vnd.oci.image.manifest.v1+json';
const dockerManifest = 'application/vnd.docker.distribution.manifest.v2+json';

interface FakeImage {
  /** The manifest media type the registry serves. */
  mediaType?: string;
  /** Layer blobs, bottom first. */
  layers: Buffer[];
  /** Serve this instead of the top layer's real bytes, to corrupt it. */
  servedTopLayer?: Buffer;
  /** Serve an image index instead of an image manifest. */
  index?: boolean;
  /** Leave the optional mediaType out of the manifest, so only the Content-Type header names it. */
  untyped?: boolean;
}

/** A registry speaking the HTTP API v2 for one image, `objectle-content:<tag>`; resolves to its host:port. */
async function fakeRegistry(tag: string, image: FakeImage): Promise<{ host: string; close: () => void }> {
  const { mediaType = dockerManifest, layers, servedTopLayer, index = false, untyped = false } = image;
  const manifest = index
    ? { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [] }
    : {
        schemaVersion: 2,
        mediaType,
        config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: digest(Buffer.from('{}')), size: 2 },
        layers: layers.map((layer) => ({
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          digest: digest(layer),
          size: layer.length,
        })),
      };
  const blobs = new Map(layers.map((layer, i) => [digest(layer), i === layers.length - 1 ? (servedTopLayer ?? layer) : layer]));
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? '';
    if (url === `/v2/objectle-content/manifests/${tag}`) {
      const accepted = request.headers.accept ?? '';
      if (!index && !accepted.includes(manifest.mediaType)) return response.writeHead(404).end();
      const body = untyped ? { ...manifest, mediaType: undefined } : manifest;
      return response.writeHead(200, { 'content-type': manifest.mediaType }).end(JSON.stringify(body));
    }
    const blob = url.startsWith('/v2/objectle-content/blobs/') ? blobs.get(url.slice(27)) : undefined;
    if (blob !== undefined) return response.writeHead(200).end(blob);
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { host: `127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const deployedBundle = JSON.stringify({ launchDate: '2027-03-01', schedule: [{ puzzleNumber: 1, noun: 'teapot' }] });
const modelLayer = gzipSync(tar({ 'models/teapot.glb': 'glb bytes' }));

describe('fetch-bundle', () => {
  test.each([
    ['a Docker schema2', dockerManifest],
    ['an OCI', ociManifest],
  ])("writes the deployed bundle.json from the top layer of %s manifest's image", async (_, mediaType) => {
    const registry = await fakeRegistry('1a2b3c4d-7', {
      mediaType,
      layers: [modelLayer, gzipSync(tar({ 'bundle.json': deployedBundle }))],
    });
    try {
      const dir = join(await tempDir('deployed'), 'deployed');
      const run = await publish('fetch-bundle', `${registry.host}/objectle-content:1a2b3c4d-7`, dir);
      expect(run.status).toBe(0);
      expect(await readFile(join(dir, 'bundle.json'), 'utf8')).toBe(deployedBundle);
      expect(await readdir(dir)).toEqual(['bundle.json']);
    } finally {
      registry.close();
    }
  });

  test('takes the manifest media type from the Content-Type header when the manifest leaves it out', async () => {
    const registry = await fakeRegistry('t', {
      mediaType: ociManifest,
      untyped: true,
      layers: [gzipSync(tar({ 'bundle.json': deployedBundle }))],
    });
    try {
      const dir = await tempDir('deployed');
      const run = await publish('fetch-bundle', `${registry.host}/objectle-content:t`, dir);
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(await readFile(join(dir, 'bundle.json'), 'utf8')).toBe(deployedBundle);
    } finally {
      registry.close();
    }
  });

  test('reads an uncompressed layer and a ./ path', async () => {
    const registry = await fakeRegistry('t', { layers: [tar({ './bundle.json': deployedBundle })] });
    try {
      const dir = await tempDir('deployed');
      const run = await publish('fetch-bundle', `${registry.host}/objectle-content:t`, dir);
      expect(run.status).toBe(0);
      expect(await readFile(join(dir, 'bundle.json'), 'utf8')).toBe(deployedBundle);
    } finally {
      registry.close();
    }
  });

  test.each([
    ['an image with no such tag', { layers: [] }, 'other-tag', 'manifest'],
    ['a top layer without bundle.json', { layers: [modelLayer] }, 't', 'has no bundle.json'],
    [
      'a top layer whose bytes are not its digest',
      { layers: [gzipSync(tar({ 'bundle.json': deployedBundle }))], servedTopLayer: gzipSync(tar({ 'bundle.json': '{}' })) },
      't',
      'does not match its digest',
    ],
    ['an image index', { layers: [], index: true }, 't', 'not a single image'],
  ])('fails on %s, writing nothing', async (_, image: FakeImage, tag, problem) => {
    const registry = await fakeRegistry('t', image);
    try {
      const dir = join(await tempDir('deployed'), 'deployed');
      const run = await publish('fetch-bundle', `${registry.host}/objectle-content:${tag}`, dir);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(problem);
      await expect(readdir(dir)).rejects.toThrow();
    } finally {
      registry.close();
    }
  });

  test('fails when the registry cannot be reached', async () => {
    const registry = await fakeRegistry('t', { layers: [] });
    registry.close();
    const run = await publish('fetch-bundle', `${registry.host}/objectle-content:t`, await tempDir('deployed'));
    expect(run.status).toBe(1);
  });

  test('refuses a reference with no registry', async () => {
    const run = await publish('fetch-bundle', 'objectle-content', await tempDir('deployed'));
    expect(run.status).toBe(2);
  });
});

/** Every file under a directory, by path relative to it. */
async function tree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** A built content bundle of `count` nouns, each with a model and, in the Answer Pool, six stage assets. */
async function bundleDir(count: number): Promise<string> {
  const dir = await tempDir('bundle');
  const names = Array.from({ length: count }, (_, i) => `noun ${i + 1}`);
  const guessVocabulary = names.map((name) => ({ name, model: `models/${name}.glb` }));
  const answerPool = names.slice(0, count - 1).map((noun) => ({
    noun,
    revealStages: [1, 2, 3, 4, 5, 6].map((stage) => ({ assets: [`assets/${noun}-stage-${stage}.webp`] })),
  }));
  const files = [...guessVocabulary.map(({ model }) => model), ...answerPool.flatMap(({ revealStages }) => revealStages.flatMap(({ assets }) => assets))];
  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), `bytes of ${file}`);
  }
  await writeFile(join(dir, 'bundle.json'), JSON.stringify({ launchDate: '2027-03-01', guessVocabulary, answerPool, schedule: [] }));
  return dir;
}

describe('image-context', () => {
  test('writes a from-scratch Dockerfile: noun shards, then bundle.json alone in the top layer', async () => {
    const bundle = await bundleDir(40);
    const context = join(await tempDir('context'), 'context');
    const run = await publish('image-context', bundle, context);
    expect(run.status).toBe(0);

    const lines = (await readFile(join(context, 'Dockerfile'), 'utf8')).split('\n').filter((line) => /^[A-Z]/.test(line));
    expect(lines[0]).toBe('FROM scratch');
    expect(lines.at(-1)).toBe('COPY bundle.json /bundle.json');
    const shards = lines.slice(1, -1);
    expect(shards.length).toBeGreaterThan(8);
    expect(shards.length).toBeLessThanOrEqual(16);
    for (const line of shards) expect(line).toMatch(/^COPY shards\/[0-9a-f]\/ \/$/);

    // Every bundle file is in exactly one shard, at its bundle path; bundle.json in none.
    const files = await tree(context);
    const bundleFiles = (await tree(bundle)).filter((file) => file !== 'bundle.json');
    const sharded = files.filter((file) => file.startsWith('shards/'));
    expect(sharded.map((file) => file.slice('shards/x/'.length)).sort()).toEqual(bundleFiles);
    expect(await readFile(join(context, 'bundle.json'), 'utf8')).toBe(await readFile(join(bundle, 'bundle.json'), 'utf8'));
    for (const file of sharded) {
      expect(await readFile(join(context, file), 'utf8')).toBe(`bytes of ${file.slice('shards/x/'.length)}`);
    }
    // Each shard COPY line names a shard that holds files.
    expect(new Set(sharded.map((file) => file.slice(0, 'shards/x/'.length)))).toEqual(
      new Set(shards.map((line) => line.split(' ')[1])),
    );

    // A noun's model and stage assets share a shard.
    const shardOf = new Map(sharded.map((file) => [file.slice('shards/x/'.length), file[7]]));
    for (let i = 1; i < 40; i++) {
      const shard = shardOf.get(`models/noun ${i}.glb`);
      for (let stage = 1; stage <= 6; stage++) expect(shardOf.get(`assets/noun ${i}-stage-${stage}.webp`)).toBe(shard);
    }
  });

  test('shards the same nouns the same way on every build', async () => {
    const bundle = await bundleDir(12);
    const [first, second] = [join(await tempDir('context'), 'c'), join(await tempDir('context'), 'c')];
    await publish('image-context', bundle, first);
    await publish('image-context', bundle, second);
    expect(await tree(second)).toEqual(await tree(first));
    expect(await readFile(join(second, 'Dockerfile'), 'utf8')).toBe(await readFile(join(first, 'Dockerfile'), 'utf8'));
  });

  test('writes a bundle.json-only image for a bundle with no files', async () => {
    const bundle = await tempDir('bundle');
    await writeFile(join(bundle, 'bundle.json'), JSON.stringify({ guessVocabulary: [], answerPool: [], schedule: [] }));
    const context = join(await tempDir('context'), 'context');
    const run = await publish('image-context', bundle, context);
    expect(run.status).toBe(0);
    const lines = (await readFile(join(context, 'Dockerfile'), 'utf8')).split('\n').filter((line) => /^[A-Z]/.test(line));
    expect(lines).toEqual(['FROM scratch', 'COPY bundle.json /bundle.json']);
    expect(await tree(context)).toEqual(['Dockerfile', 'bundle.json']);
  });

  test('refuses a context directory that is not empty', async () => {
    const context = await tempDir('context');
    await writeFile(join(context, 'leftover'), '');
    const run = await publish('image-context', await bundleDir(2), context);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not empty');
  });

  test('fails on a bundle directory with no bundle.json', async () => {
    const run = await publish('image-context', await tempDir('bundle'), join(await tempDir('context'), 'c'));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('bundle.json');
  });

  test('fails on a bundle.json that is not JSON, naming it', async () => {
    const bundle = await tempDir('bundle');
    await writeFile(join(bundle, 'bundle.json'), 'not json');
    const context = join(await tempDir('context'), 'context');
    const run = await publish('image-context', bundle, context);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${bundle}/bundle.json is not JSON`);
    await expect(readdir(context)).rejects.toThrow();
  });

  test('fails on a bundle file that is missing, naming it, before writing any of the context', async () => {
    const bundle = await bundleDir(12);
    await rm(join(bundle, 'assets/noun 11-stage-6.webp'));
    const context = join(await tempDir('context'), 'context');
    const run = await publish('image-context', bundle, context);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('assets/noun 11-stage-6.webp');
    await expect(readdir(context)).rejects.toThrow();
  });
});

describe('deploy (dry run)', () => {
  const image = 'registry.example:5000/objectle-content:5e6f7a8b-12';
  const marker = `            reference: ${image} # objectle-content-image`;

  test('prints the content image marker line and the commit message, and changes nothing', async () => {
    const file = await deploymentFile({ launchDate: '"2026-11-25"' });
    const before = await readFile(file, 'utf8');
    const run = await publish('deploy', '--dry-run', '--now', '2027-06-01T12:00:00-07:00', file, image);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${marker}\n`);
    expect(run.stdout).toContain('🚀 Deploy objectle-content:5e6f7a8b-12\n');
    expect(run.stdout).toContain('dry run');
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  test.each([
    ['late on the eve of the Launch Date', '2027-02-28T23:59:00-08:00'],
    ['weeks before', '2027-02-01T12:00:00-08:00'],
  ])('a first publish (the tag pending) passes %s', async (_, now) => {
    const contentImage = 'registry.example:5000/objectle-content:pending # objectle-content-image';
    const run = await publish('deploy', '--dry-run', '--now', now, await deploymentFile({ contentImage }), image);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${marker}\n`);
  });

  test.each([
    ['on the Launch Date, just after midnight Pacific', '2027-03-01T00:01:00-08:00'],
    ['after it', '2027-06-01T12:00:00-07:00'],
  ])('a first publish (the tag pending) is refused %s', async (_, now) => {
    const contentImage = 'registry.example:5000/objectle-content:pending # objectle-content-image';
    const run = await publish('deploy', '--dry-run', '--now', now, await deploymentFile({ contentImage }), image);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('no content image has been published');
    expect(run.stderr).toContain('2027-03-01');
    expect(run.stdout).toBe('');
  });

  test('a first publish with no marker in the Deployment is refused even before launch', async () => {
    const file = await deploymentFile({ contentImage: '' });
    const run = await publish('deploy', '--dry-run', '--now', '2027-02-01T12:00:00-08:00', file, image);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('no content image marker');
  });

  test.each([
    ['without --dry-run', ['deploy', 'deployment.yaml', image]],
    ['with a bad instant', ['deploy', '--dry-run', '--now', 'soon', 'deployment.yaml', image]],
    ['with a bad image reference', ['deploy', '--dry-run', 'deployment.yaml', 'objectle content']],
  ])('is a usage error %s', async (_, args) => {
    expect((await publish(...args)).status).toBe(2);
  });
});

describe('guard', () => {
  // Launch Date 2027-03-01: Puzzle Number 14 is 2027-03-14, when Pacific time
  // springs forward, and 252 is 2027-11-07, when it falls back.
  const nouns = Array.from({ length: 300 }, (_, index) => `object ${index + 1}`);

  /** A bundle directory whose Schedule assigns `nouns`, with `changes` by Puzzle Number (null drops one). */
  async function bundle(changes: Record<number, string | null> = {}): Promise<string> {
    const dir = await tempDir('bundle');
    const schedule = nouns
      .map((noun, index) => ({ puzzleNumber: index + 1, noun: changes[index + 1] ?? noun, pinned: false }))
      .filter(({ puzzleNumber }) => changes[puzzleNumber] !== null);
    await writeFile(
      join(dir, 'bundle.json'),
      JSON.stringify({ launchDate: '2027-03-01', guessVocabulary: [], answerPool: [], schedule }),
    );
    return dir;
  }

  const guard = async (now: string, changes: Record<number, string | null>) =>
    publish('guard', '--now', now, await bundle(), await bundle(changes));

  test('passes identical Schedules', async () => {
    const run = await guard('2027-06-01T12:00:00-07:00', {});
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Puzzle Number 93');
    expect(run.stderr).toBe('');
  });

  test('passes a difference only after the active Puzzle Number', async () => {
    const run = await guard('2027-06-01T12:00:00-07:00', { 94: 'kettle', 200: null });
    expect(run.status).toBe(0);
  });

  test('refuses a difference at or before the active Puzzle Number, listing each', async () => {
    const run = await guard('2027-06-01T12:00:00-07:00', { 1: 'kettle', 50: null, 93: 'lamp', 94: 'kettle' });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.match(/^Puzzle Number \d+/gm)).toEqual(['Puzzle Number 1', 'Puzzle Number 50', 'Puzzle Number 93']);
    expect(run.stderr).toContain('"kettle"');
    expect(run.stderr).toContain('not deploying');
  });

  test('refuses an active Puzzle Number the deployed bundle does not have', async () => {
    const dir = await tempDir('bundle');
    await writeFile(join(dir, 'bundle.json'), JSON.stringify({ launchDate: '2027-03-01', schedule: [] }));
    const run = await publish('guard', '--now', '2027-03-01T12:00:00-08:00', dir, await bundle());
    expect(run.status).toBe(1);
    expect(run.stderr.match(/^Puzzle Number \d+/gm)).toEqual(['Puzzle Number 1']);
  });

  test('refuses a new bundle built for another Launch Date, naming both', async () => {
    const dir = await tempDir('bundle');
    await writeFile(join(dir, 'bundle.json'), JSON.stringify({ launchDate: '2027-03-02', schedule: [] }));
    const run = await publish('guard', '--now', '2027-02-01T12:00:00-08:00', await bundle(), dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('2027-03-02');
    expect(run.stderr).toContain('2027-03-01');
  });

  test('passes any difference before launch', async () => {
    const run = await guard('2027-02-28T23:59:00-08:00', { 1: 'kettle', 2: null });
    expect(run.status).toBe(0);
  });

  test.each([
    ['the last minute before a Pacific midnight', '2027-03-10T07:59:00Z', 9],
    ['a Pacific midnight', '2027-03-10T08:00:00Z', 10],
    ['the last minute of the day Pacific time springs forward', '2027-03-15T06:59:00Z', 14],
    ['the midnight after it springs forward', '2027-03-15T07:00:00Z', 15],
    ['the last minute of the day Pacific time falls back', '2027-11-08T07:59:00Z', 252],
    ['the midnight after it falls back', '2027-11-08T08:00:00Z', 253],
  ])('takes the active Puzzle Number from the instant at %s', async (_, now, active) => {
    const after = await guard(now, { [active + 1]: 'kettle' });
    expect(after.status).toBe(0);
    const at = await guard(now, { [active]: 'kettle', [active + 1]: 'kettle' });
    expect(at.status).toBe(1);
    expect(at.stderr.match(/^Puzzle Number \d+/gm)).toEqual([`Puzzle Number ${active}`]);
  });

  test.each([
    ['no bundle.json', () => tempDir('bundle')],
    [
      'a bundle.json with no Schedule',
      async () => {
        const dir = await tempDir('bundle');
        await writeFile(join(dir, 'bundle.json'), '{"launchDate":"2027-03-01"}');
        return dir;
      },
    ],
  ])('fails on a bundle directory with %s', async (_, makeDir) => {
    const run = await publish('guard', '--now', '2027-06-01T12:00:00-07:00', await bundle(), await makeDir());
    expect(run.status).toBe(1);
    expect(run.stderr).not.toBe('');
  });

  test.each([
    ['with one bundle', ['guard', 'deployed']],
    ['with a bad instant', ['guard', '--now', 'soon', 'deployed', 'bundle']],
    ['with --dry-run', ['guard', '--dry-run', 'deployed', 'bundle']],
  ])('is a usage error %s', async (_, args) => {
    expect((await publish(...args)).status).toBe(2);
  });
});

test('an unknown command is a usage error', async () => {
  expect((await publish('publish')).status).toBe(2);
  expect((await publish()).status).toBe(2);
});
