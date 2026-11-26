import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Tests that spawn the curation build take about 2 s alone, but run beside
    // the stage-authoring tests' software-rendered Chromium they can pass 5 s.
    testTimeout: 15_000,
  },
});
