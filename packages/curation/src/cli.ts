// The curation build's command-line tool:
//   node packages/curation/src/cli.ts --launch-date <YYYY-MM-DD> (--previous-bundle <dir> | --first-publish)
//     [--now <instant>] [--seed <text>] <content-dir> <bundle-dir>
// --previous-bundle names the previously published content bundle (or a copy
// of the deployed one, to preview a change), whose Schedule the build extends;
// only --first-publish starts from an empty Schedule, so a missing read-back
// can never restart it (ADR-0008). --now (an ISO 8601 instant, the real clock
// by default) decides the active Puzzle Number; --seed is mixed into the
// shuffle that breaks Schedule ties. Exits 0 having written the content
// bundle, reporting any Schedule shortfall and Difficulty Pattern substitution
// and listing the upcoming Schedule on stdout; 1 listing every content problem
// (one per line on stderr); or 2 on a usage error.
import { parseArgs } from 'node:util';
import { buildContent } from './build.ts';
import { dayOf } from './schedule.ts';

const usage =
  'usage: node packages/curation/src/cli.ts --launch-date <YYYY-MM-DD> (--previous-bundle <dir> | --first-publish) ' +
  '[--now <instant>] [--seed <text>] <content-dir> <bundle-dir>';

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      'launch-date': { type: 'string' },
      'previous-bundle': { type: 'string' },
      'first-publish': { type: 'boolean' },
      now: { type: 'string' },
      seed: { type: 'string' },
    },
  });
} catch (error) {
  console.error(`${(error as Error).message}\n${usage}`);
  process.exit(2);
}
const { values, positionals } = parsed;
const now = values.now === undefined ? new Date() : new Date(values.now);
const launchDate = values['launch-date'];
const previousBundle = values['previous-bundle'];
if (
  positionals.length !== 2 ||
  dayOf(launchDate) === undefined ||
  Number.isNaN(now.getTime()) ||
  (previousBundle === undefined) === (values['first-publish'] !== true)
) {
  console.error(usage);
  process.exit(2);
}
const [contentDir, bundleDir] = positionals;

const { problems, notices, upcoming } = await buildContent(contentDir, bundleDir, {
  launchDate: launchDate!,
  now,
  previousBundle,
  seed: values.seed,
});
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`curation build failed: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${contentDir}`);
  process.exitCode = 1;
} else {
  for (const notice of notices) console.log(notice);
  console.log('upcoming Schedule:');
  for (const { puzzleNumber, noun, pinned } of upcoming) {
    const date = new Date((dayOf(launchDate)! + puzzleNumber - 1) * 86_400_000).toISOString().slice(0, 10);
    console.log(`Puzzle Number ${puzzleNumber} on ${date}: ${noun}${pinned ? ', Pinned' : ''}`);
  }
  console.log(`wrote the content bundle to ${bundleDir}`);
}
