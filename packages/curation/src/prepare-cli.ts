// Asset preparation's command-line tool:
//   node packages/curation/src/prepare-cli.ts <content-dir> <noun> <source-model>
// Prepares a sourced .gltf or .glb as the model of a Guess Vocabulary noun,
// writing it to the model path the noun's entry names. Exits 0 having written
// it (reporting what to check on stdout), 1 listing every problem (one per
// line on stderr, nothing written), or 2 on a usage error.
import { prepareModel } from './prepare.ts';

const args = process.argv.slice(2);
if (args.length !== 3) {
  console.error('usage: node packages/curation/src/prepare-cli.ts <content-dir> <noun> <source-model>');
  process.exit(2);
}
const [contentDir, noun, source] = args;

const { problems, report } = await prepareModel(contentDir, noun, source);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`asset preparation failed: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  process.exitCode = 1;
} else {
  for (const line of report) console.log(line);
}
