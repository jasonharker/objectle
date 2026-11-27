// Finding a Chromium to render Reveal Stages in. It needs WebGL 2; software
// rendering is enough.
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { chromium } from 'playwright-core';

const commands = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];

/**
 * The Chromium to launch: $OBJECTLE_CHROMIUM if set, else Playwright's own
 * download if there is one, else the first Chromium on $PATH; undefined if
 * none is found.
 */
export function chromiumPath(): string | undefined {
  if (process.env.OBJECTLE_CHROMIUM) return process.env.OBJECTLE_CHROMIUM;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const command of commands) {
      if (dir && existsSync(join(dir, command))) return join(dir, command);
    }
  }
  return undefined;
}

/** Launch a headless Chromium, or explain how to provide one. */
export async function launchChromium() {
  const executablePath = chromiumPath();
  if (executablePath === undefined) {
    throw new Error('no Chromium found: install one on $PATH, or set OBJECTLE_CHROMIUM to its executable');
  }
  return chromium.launch({ executablePath });
}
