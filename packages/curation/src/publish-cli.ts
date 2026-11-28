// The publish commands of the curation tool, which the content repo's publish
// pipeline runs around the curation build (ADR-0008):
//   node packages/curation/src/publish-cli.ts read-back <deployment-yaml>
//   node packages/curation/src/publish-cli.ts fetch-bundle <image> <dir>
//   node packages/curation/src/publish-cli.ts image-context <bundle-dir> <context-dir>
//   node packages/curation/src/publish-cli.ts deploy --dry-run [--now <instant>] <deployment-yaml> <image>
//   node packages/curation/src/publish-cli.ts guard [--now <instant>] <deployed-bundle-dir> <bundle-dir>
//   node packages/curation/src/publish-cli.ts retain [--dry-run] <deployed-image>
// read-back prints, from the GitOps repo's objectle Deployment, the Launch
// Date and the deployed content image (empty when none has ever been
// published) as LAUNCH_DATE=… and CONTENT_IMAGE=… lines for a shell to source.
// fetch-bundle writes that image's bundle.json, the single file of its top
// layer, into <dir>, over the registry HTTP API (plain HTTP: the LAN registry).
// image-context writes a from-scratch Dockerfile and its build context for a
// built content bundle. deploy applies the first-publish rule and prints the
// deploy commit it would make; it changes nothing (arming the real deploy
// commit is the launch switch's step). guard is the midnight guard: it refuses
// a new bundle whose Schedule differs from the deployed bundle's on any Puzzle
// Number up to the one active at the instant (--now, the real clock by
// default), listing each. retain is content image retention, run after a
// deploy: it keeps the deployed image, every publish newer than it and the five
// images before it, and deletes the older content image manifests by digest
// (the registry's nightly garbage collection frees their blobs). It touches only
// the objectle-content repository, never deletes a digest a kept tag shares,
// and keeps any tag that is not a publish tag (<commit>-<build>); --dry-run
// lists what it would delete. Each exits 0 on success, 1 naming the
// problem that stopped it on stderr, or 2 on a usage error.
import { createHash } from 'node:crypto';
import { constants, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import type { ScheduleEntry } from '@objectle/shared';
import { staysInside } from './build.ts';
import { dayOf, pacificDateAt } from './schedule.ts';

const usage = [
  'usage: node packages/curation/src/publish-cli.ts read-back <deployment-yaml>',
  '       node packages/curation/src/publish-cli.ts fetch-bundle <image> <dir>',
  '       node packages/curation/src/publish-cli.ts image-context <bundle-dir> <context-dir>',
  '       node packages/curation/src/publish-cli.ts deploy --dry-run [--now <instant>] <deployment-yaml> <image>',
  '       node packages/curation/src/publish-cli.ts guard [--now <instant>] <deployed-bundle-dir> <bundle-dir>',
  '       node packages/curation/src/publish-cli.ts retain [--dry-run] <deployed-image>',
].join('\n');

/** The comment that marks the content image reference in the Deployment. */
const marker = '# objectle-content-image';
/** The tag the Deployment names until the first publish: no content image has ever been published. */
const pendingTag = 'pending';

/** An image reference with its registry: host[:port]/repository(:tag|@digest). Narrow enough to source in a shell. */
const imagePattern = /^([\w.-]+(?::\d+)?)\/([a-z0-9]+(?:[._/-][a-z0-9]+)*)(?::([\w][\w.-]{0,127})|@(sha256:[0-9a-f]{64}))$/;

class Problem extends Error {}
const fail = (message: string): never => {
  throw new Problem(message);
};

interface ReadBack {
  launchDate: string;
  /** The deployed content image; undefined if none has ever been published. */
  contentImage?: string;
  /** The Deployment's content image marker line, if it has one. */
  markerLine?: string;
}

// ponytail: line-based, not a YAML parser; it reads the two lines the GitOps
// repo's objectle Deployment has always written this way.
async function readBack(file: string): Promise<ReadBack> {
  const lines = (await readFile(file, 'utf8').catch((error) => fail(`${file} can't be read: ${error.message}`))).split('\n');
  const at = lines.findIndex((line) => /^\s*- name: OBJECTLE_LAUNCH_DATE\s*$/.test(line));
  if (at === -1) fail(`${file} sets no OBJECTLE_LAUNCH_DATE`);
  const launchDate = /^\s*value:\s*(["']?)([^"'\s]*)\1\s*$/.exec(lines[at + 1] ?? '')?.[2];
  if (dayOf(launchDate) === undefined) fail(`${file} has an OBJECTLE_LAUNCH_DATE that is not a YYYY-MM-DD date`);

  const markers = lines.filter((line) => line.trimEnd().endsWith(marker));
  if (markers.length > 1) fail(`${file} has more than one content image marker`);
  const [markerLine] = markers;
  if (markerLine === undefined) return { launchDate: launchDate! };
  const reference = /^\s*reference:\s*(\S+)\s+#/.exec(markerLine)?.[1] ?? '';
  const image = imagePattern.exec(reference);
  if (!image) fail(`${file} has a content image marker naming ${JSON.stringify(reference)}, which is not an image reference`);
  return { launchDate: launchDate!, contentImage: image![3] === pendingTag ? undefined : reference, markerLine };
}

const manifestTypes = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];

async function get(url: string, headers: Record<string, string> = {}): Promise<{ body: Buffer; type: string | null }> {
  const response = await fetch(url, { headers }).catch((error) => fail(`${url} can't be reached: ${error.cause?.message ?? error.message}`));
  if (!response.ok) fail(`${url} answered ${response.status}`);
  return { body: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') };
}

/** The bytes of `name` in a tar archive, or undefined. */
function untar(archive: Buffer, name: string): Buffer | undefined {
  for (let at = 0; at + 512 <= archive.length; ) {
    const header = archive.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) return undefined;
    const text = (start: number, length: number) => header.toString('latin1', start, start + length).replace(/\0.*$/s, '');
    const prefix = text(257, 6) === 'ustar' ? text(345, 155) : '';
    const path = posix.normalize((prefix ? `${prefix}/` : '') + text(0, 100)).replace(/^\/+/, '');
    const size = parseInt(text(124, 12).trim() || '0', 8);
    const type = text(156, 1);
    if (path === name && (type === '0' || type === '')) return archive.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

async function fetchBundle(reference: string, dir: string): Promise<void> {
  const [, host, repository, tag, digest] = imagePattern.exec(reference)!;
  const base = `http://${host}/v2/${repository}`;
  const { body, type } = await get(`${base}/manifests/${tag ?? digest}`, { accept: manifestTypes.join(', ') });
  const manifest = JSON.parse(body.toString('utf8'));
  // An OCI manifest's mediaType is optional; the registry's Content-Type names it then.
  const mediaType = manifest.mediaType ?? type?.split(';')[0].trim();
  if (!manifestTypes.includes(mediaType) || !Array.isArray(manifest.layers) || manifest.layers.length === 0) {
    fail(`${reference} is not a single image with layers (its manifest is ${mediaType ?? 'untyped'})`);
  }
  const top: string = manifest.layers.at(-1).digest;
  const { body: blob } = await get(`${base}/blobs/${top}`);
  if (`sha256:${createHash('sha256').update(blob).digest('hex')}` !== top) {
    fail(`${reference}'s top layer does not match its digest ${top}`);
  }
  const archive = blob[0] === 0x1f && blob[1] === 0x8b ? gunzipSync(blob) : blob;
  const bundle = untar(archive, 'bundle.json') ?? fail(`${reference}'s top layer has no bundle.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'bundle.json'), bundle);
}

/** The noun-hash shard a noun's files go in: one of 16, by the first hex digit of its SHA-256. */
const shardOf = (noun: string) => createHash('sha256').update(noun).digest('hex')[0];

async function imageContext(bundleDir: string, contextDir: string): Promise<void> {
  const entries = await readdir(contextDir).catch(() => []);
  if (entries.length > 0) fail(`context directory ${contextDir} is not empty`);
  const text = await readFile(join(bundleDir, 'bundle.json'), 'utf8').catch(() =>
    fail(`${bundleDir} has no bundle.json, so it is not a built content bundle`),
  );
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch {
    fail(`${bundleDir}/bundle.json is not JSON`);
  }
  /** Each bundle file's shard; a file two nouns name goes with the first. */
  const shards = new Map<string, string>();
  const add = (path: unknown, noun: string) => {
    if (typeof path !== 'string' || !staysInside(path)) fail(`bundle.json names ${JSON.stringify(path)}, which is not a bundle file`);
    if (!shards.has(path as string)) shards.set(path as string, shardOf(noun));
  };
  for (const { name, model } of bundle.guessVocabulary ?? []) add(model, name);
  for (const { noun, revealStages } of bundle.answerPool ?? []) {
    for (const { assets } of revealStages ?? []) for (const asset of assets ?? []) add(asset, noun);
  }
  // Every file is checked before any is copied, so a failure leaves no half-filled context.
  const missing = [];
  for (const path of shards.keys()) {
    if (!(await stat(join(bundleDir, path)).then((s) => s.isFile(), () => false))) missing.push(path);
  }
  if (missing.length > 0) fail(missing.map((path) => `bundle.json names ${path}, which is missing from ${bundleDir}`).join('\n'));
  for (const [path, shard] of shards) {
    const target = join(contextDir, 'shards', shard, path);
    await mkdir(dirname(target), { recursive: true });
    // Reflinks where the filesystem has them, so a large content set is not copied twice.
    await copyFile(join(bundleDir, path), target, constants.COPYFILE_FICLONE);
  }
  await mkdir(contextDir, { recursive: true });
  await writeFile(join(contextDir, 'bundle.json'), text);
  const layers = [...new Set(shards.values())].sort().map((shard) => `COPY shards/${shard}/ /`);
  await writeFile(
    join(contextDir, 'Dockerfile'),
    [
      '# The content image (objectle ADR-0008): the content bundle at the image root, models and',
      '# stage assets in layers by a hash of their noun, and bundle.json alone in the top layer.',
      '# Build it reproducibly, so unchanged layers keep their digests.',
      'FROM scratch',
      ...layers,
      'COPY bundle.json /bundle.json',
      '',
    ].join('\n'),
  );
}

/** The first-publish rule, then the deploy commit the publish would make, printed. */
async function deployDryRun(file: string, image: string, now: Date): Promise<void> {
  const { launchDate, contentImage, markerLine } = await readBack(file);
  const today = pacificDateAt(now);
  if (contentImage === undefined && !(launchDate > today)) {
    fail(
      `no content image has been published and the deployed Launch Date ${launchDate} is not after today, ${today} ` +
        'Pacific; set the real, future Launch Date before the first publish (see the launch checklist)',
    );
  }
  if (markerLine === undefined) fail(`${file} has no content image marker line (${marker}) to rewrite`);
  const line = markerLine!.replace(/reference:\s*\S+/, `reference: ${image}`);
  console.log(`dry run: would rewrite the content image marker line in ${file} to\n${line}`);
  console.log(`and commit it as\n🚀 Deploy ${image.slice(image.lastIndexOf('/') + 1)}`);
}

/** A bundle directory's Launch Date and Schedule, as noun by Puzzle Number. */
async function readSchedule(dir: string): Promise<{ launchDate: string; nouns: Map<number, string> }> {
  const text = await readFile(join(dir, 'bundle.json'), 'utf8').catch(() =>
    fail(`${dir} has no bundle.json, so it is not a built content bundle`),
  );
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch {
    fail(`${dir}/bundle.json is not JSON`);
  }
  if (dayOf(bundle?.launchDate) === undefined || !Array.isArray(bundle.schedule)) {
    fail(`${dir}/bundle.json has no Launch Date or no Schedule`);
  }
  return {
    launchDate: bundle.launchDate,
    nouns: new Map(bundle.schedule.map(({ puzzleNumber, noun }: ScheduleEntry) => [puzzleNumber, noun])),
  };
}

/** The midnight guard: the new Schedule must match the deployed one through the active Puzzle Number. */
async function guard(deployedDir: string, bundleDir: string, now: Date): Promise<void> {
  // The deployed Launch Date is the one players count Puzzle Numbers from.
  const deployed = await readSchedule(deployedDir);
  const { launchDate, nouns } = await readSchedule(bundleDir);
  if (launchDate !== deployed.launchDate) {
    fail(
      `midnight guard: the new bundle is built for Launch Date ${launchDate}, not the deployed Launch Date ` +
        `${deployed.launchDate}; not deploying`,
    );
  }
  const active = dayOf(pacificDateAt(now))! - dayOf(deployed.launchDate)! + 1;
  const name = (noun: string | undefined) => (noun === undefined ? 'nothing' : JSON.stringify(noun));
  const differences: string[] = [];
  for (let puzzleNumber = 1; puzzleNumber <= active; puzzleNumber++) {
    const [was, is] = [deployed.nouns.get(puzzleNumber), nouns.get(puzzleNumber)];
    if (was !== is) {
      differences.push(`Puzzle Number ${puzzleNumber} is ${name(was)} in the deployed bundle but ${name(is)} in the new one`);
    }
  }
  if (differences.length > 0) {
    fail(
      [
        ...differences,
        `midnight guard: the new Schedule changes ${differences.length} Puzzle Number` +
          `${differences.length === 1 ? '' : 's'} up to the active one, ${active}; not deploying, so the deployed ` +
          'content image stays and the next publish rebuilds from it',
      ].join('\n'),
    );
  }
  console.log(
    active < 1
      ? 'midnight guard: before launch, so no Puzzle Number is active yet'
      : `midnight guard: the new Schedule matches the deployed one through the active Puzzle Number ${active}`,
  );
}

/** The only registry repository retention may delete from. */
const contentRepository = 'objectle-content';
/** The images retention keeps before the deployed one (ADR-0008). */
const keptBefore = 5;
/** A tag the publish pipeline writes: the content commit's first 8 hex digits, then the build number. */
const publishTag = /^[0-9a-f]{8}-(\d+)$/;

async function request(method: string, url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { method, headers }).catch((error) => fail(`${url} can't be reached: ${error.cause?.message ?? error.message}`));
}

/** Content image retention: keep the deployed image, newer publishes and the five images before it; delete the rest. */
async function retain(reference: string, dryRun: boolean): Promise<void> {
  const [, host, repository, deployedTag] = imagePattern.exec(reference)!;
  if (repository !== contentRepository) fail(`retention touches only the ${contentRepository} repository, not ${repository}`);
  const base = `http://${host}/v2/${repository}`;
  const { body } = await get(`${base}/tags/list`);
  const tags: string[] = JSON.parse(body.toString('utf8')).tags ?? [];
  if (!tags.includes(deployedTag)) fail(`${reference} is not in the registry; deleting nothing`);

  const digestOf = async (tag: string): Promise<string> => {
    const response = await request('HEAD', `${base}/manifests/${tag}`, { accept: manifestTypes.join(', ') });
    const digest = response.headers.get('docker-content-digest');
    if (!response.ok || digest === null) fail(`${repository}:${tag} answered ${response.status} with no manifest digest`);
    return digest!;
  };
  const digests = new Map<string, string>();
  for (const tag of tags) digests.set(tag, await digestOf(tag));

  const build = (tag: string) => Number(publishTag.exec(tag)?.[1]);
  const deployedBuild = build(deployedTag);
  /** Why each kept tag is kept; a digest any of them names is never deleted. */
  const reasons = new Map<string, string>();
  for (const tag of tags) {
    if (tag === deployedTag) reasons.set(tag, 'deployed');
    else if (!publishTag.test(tag)) reasons.set(tag, 'not a publish tag');
    else if (!(build(tag) < deployedBuild)) reasons.set(tag, 'newer than the deployed image');
  }
  const older = tags.filter((tag) => !reasons.has(tag)).sort((a, b) => build(b) - build(a));
  const kept = new Set([...reasons.keys()].map((tag) => digests.get(tag)!));
  let before = 0;
  for (const tag of older) {
    const digest = digests.get(tag)!;
    if (kept.has(digest)) {
      reasons.set(tag, 'the same image as a kept tag');
    } else if (before < keptBefore) {
      before++;
      kept.add(digest);
      reasons.set(tag, `one of the ${keptBefore} images before the deployed one`);
    }
  }

  // Newest publish first, then the tags that are not publish tags.
  const listed = [...tags].sort((a, b) => (build(b) || -1) - (build(a) || -1));
  for (const tag of listed.filter((tag) => reasons.has(tag))) console.log(`keep ${repository}:${tag} (${reasons.get(tag)})`);
  const doomed = older.filter((tag) => !reasons.has(tag));
  if (doomed.length === 0) {
    console.log(`nothing to delete from ${repository}`);
    return;
  }
  if (dryRun) {
    for (const tag of doomed) console.log(`dry run: would delete ${repository}:${tag} (${digests.get(tag)})`);
    return;
  }
  // One delete per digest: the registry removes every tag that names it.
  const deleted = new Set<string>();
  for (const tag of doomed) {
    const digest = digests.get(tag)!;
    if (!deleted.has(digest)) {
      const response = await request('DELETE', `${base}/manifests/${digest}`);
      if (response.status !== 202 && response.status !== 404) {
        fail(`deleting ${repository}:${tag} (${digest}) answered ${response.status}`);
      }
      deleted.add(digest);
    }
    console.log(`deleted ${repository}:${tag} (${digest})`);
  }
  // Read the registry back: the deleted tags are gone and every kept tag still names its image.
  const left: string[] = JSON.parse((await get(`${base}/tags/list`)).body.toString('utf8')).tags ?? [];
  const lingering = doomed.filter((tag) => left.includes(tag));
  if (lingering.length > 0) fail(`the registry still lists ${lingering.map((tag) => `${repository}:${tag}`).join(', ')}`);
  for (const tag of reasons.keys()) {
    if (!left.includes(tag) || (await digestOf(tag)) !== digests.get(tag)) fail(`kept tag ${repository}:${tag} no longer names its image`);
  }
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: { 'dry-run': { type: 'boolean' }, now: { type: 'string' } },
  });
} catch (error) {
  console.error(`${(error as Error).message}\n${usage}`);
  process.exit(2);
}
const { values, positionals } = parsed;
const [command, ...args] = positionals;
const now = values.now === undefined ? new Date() : new Date(values.now);
const isImage = (reference: string | undefined) => reference !== undefined && imagePattern.test(reference);
const valid =
  (command === 'read-back' && args.length === 1) ||
  (command === 'fetch-bundle' && args.length === 2 && isImage(args[0])) ||
  (command === 'image-context' && args.length === 2) ||
  (command === 'deploy' && args.length === 2 && values['dry-run'] === true && isImage(args[1]) && !Number.isNaN(now.getTime())) ||
  (command === 'guard' && args.length === 2 && values['dry-run'] === undefined && !Number.isNaN(now.getTime())) ||
  (command === 'retain' && args.length === 1 && imagePattern.exec(args[0])?.[3] !== undefined);
if (
  !valid ||
  (command !== 'deploy' && command !== 'retain' && values['dry-run'] !== undefined) ||
  (command !== 'deploy' && command !== 'guard' && values.now !== undefined)
) {
  console.error(usage);
  process.exit(2);
}

try {
  if (command === 'read-back') {
    const { launchDate, contentImage = '' } = await readBack(args[0]);
    console.log(`LAUNCH_DATE=${launchDate}\nCONTENT_IMAGE=${contentImage}`);
  } else if (command === 'fetch-bundle') {
    await fetchBundle(args[0], args[1]);
    console.log(`wrote the deployed bundle.json of ${args[0]} to ${args[1]}`);
  } else if (command === 'image-context') {
    await imageContext(args[0], args[1]);
    console.log(`wrote the content image's Dockerfile and build context to ${args[1]}`);
  } else if (command === 'deploy') {
    await deployDryRun(args[0], args[1], now);
  } else if (command === 'retain') {
    await retain(args[0], values['dry-run'] === true);
  } else {
    await guard(args[0], args[1], now);
  }
} catch (error) {
  if (!(error instanceof Problem)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
