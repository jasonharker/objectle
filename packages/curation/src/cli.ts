// The curation build's command-line tool:
//   node packages/curation/src/cli.ts --launch-date <YYYY-MM-DD> [--now <instant>] [--seed <text>] <content-dir> <bundle-dir>
// --now (an ISO 8601 instant, the real clock by default) decides the active
// Puzzle Number; --seed is mixed into the shuffle that breaks Schedule ties.
// Exits 0 having written the content bundle, reporting any Schedule shortfall
// and Difficulty Pattern substitution on stdout; 1 listing every content
// problem (one per line on stderr); or 2 on a usage error.
import { parseArgs } from 'node:util';
import { buildContent } from './build.ts';
import { dayOf } from './schedule.ts';

const usage =
  'usage: node packages/curation/src/cli.ts --launch-date <YYYY-MM-DD> [--now <instant>] [--seed <text>] <content-dir> <bundle-dir>';

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: { 'launch-date': { type: 'string' }, now: { type: 'string' }, seed: { type: 'string' } },
  });
} catch (error) {
  console.error(`${(error as Error).message}\n${usage}`);
  process.exit(2);
}
const { values, positionals } = parsed;
const now = values.now === undefined ? new Date() : new Date(values.now);
const launchDate = values['launch-date'];
if (positionals.length !== 2 || dayOf(launchDate) === undefined || Number.isNaN(now.getTime())) {
  console.error(usage);
  process.exit(2);
}
const [contentDir, bundleDir] = positionals;

const { problems, notices } = await buildContent(contentDir, bundleDir, { launchDate: launchDate!, now, seed: values.seed });
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`curation build failed: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${contentDir}`);
  process.exitCode = 1;
} else {
  for (const notice of notices) console.log(notice);
  console.log(`wrote the content bundle to ${bundleDir}`);
}
