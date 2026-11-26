// The curation build's command-line tool:
//   node packages/curation/src/cli.ts <content-dir> <bundle-dir>
// Exits 0 having written the content bundle, 1 listing every content problem
// (one per line on stderr), or 2 on a usage error.
import { buildContent } from './build.ts';

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('usage: node packages/curation/src/cli.ts <content-dir> <bundle-dir>');
  process.exit(2);
}
const [contentDir, bundleDir] = args;

const problems = await buildContent(contentDir, bundleDir);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`curation build failed: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${contentDir}`);
  process.exitCode = 1;
} else {
  console.log(`wrote the content bundle to ${bundleDir}`);
}
