// The stage-authoring tool's command-line entry:
//   node packages/authoring/src/cli.ts serve <content-dir> [--port <port>]
//     opens the tool on a content directory, at http://localhost:<port>/
//   node packages/authoring/src/cli.ts render <content-dir> [<noun>...]
//     renders the named Answer Pool objects, or every authored one, from their
//     recorded Stage Cameras in headless Chromium, and writes their Reveal Stage
//     assets and their render fingerprints: run it after retuning the shader
//     (ADR-0002) or re-preparing a model, then the curation build.
// render exits 0 having written every object's assets, 1 listing every problem
// (one per line on stderr; an object with problems keeps its earlier entry), or
// 2 on a usage error.
import { parseArgs } from 'node:util';
import { launchChromium } from './chromium.ts';
import { startAuthoringServer } from './server.ts';

const usage = [
  'usage: node packages/authoring/src/cli.ts serve <content-dir> [--port <port>]',
  '       node packages/authoring/src/cli.ts render <content-dir> [<noun>...]',
].join('\n');

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { port: { type: 'string' } } });
} catch (error) {
  console.error(`${(error as Error).message}\n${usage}`);
  process.exit(2);
}
const [command, contentDir, ...nouns] = parsed.positionals;
const port = Number(parsed.values.port ?? 5174);
if (contentDir === undefined || !Number.isInteger(port) || (command === 'serve' ? nouns.length > 0 : command !== 'render')) {
  console.error(usage);
  process.exit(2);
}

if (command === 'serve') {
  const { url } = await startAuthoringServer(contentDir, port);
  console.log(`stage-authoring tool for ${contentDir} at ${url}`);
} else {
  const { url, server } = await startAuthoringServer(contentDir, 0);
  const browser = await launchChromium().catch(async (error: Error) => {
    await server.close();
    console.error(error.message);
    process.exit(1);
  });
  let problems: string[];
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}render.html`);
    await page.waitForFunction(() => typeof window.renderAnswerPool === 'function');
    problems = await page.evaluate((nouns) => window.renderAnswerPool(nouns), nouns).catch((error: Error) => [
      ...errors,
      `rendering failed: ${error.message}`,
    ]);
  } finally {
    await browser.close();
    await server.close();
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`rendered the Reveal Stages in ${contentDir}`);
  }
}
