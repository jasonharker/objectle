// Every temporary directory a test makes, and those of the CLIs it spawns,
// goes under one fresh directory, removed when the run ends: test files call
// mkdtemp(tmpdir()) without cleaning up, and their runs once filled tmpfs.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'objectle-test-'));
  process.env.TMPDIR = dir;
  return () => rm(dir, { recursive: true, force: true });
}
