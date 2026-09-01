import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite spawns real child processes over stdio; the 5 s default is not
    // enough for a cold Node start on a loaded machine.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // A library whose whole job is to be exercised by tests. Everything here
      // is reachable from one, so the gates are the highest in the fleet after
      // mcp-approval's, and the two uncovered branches are named rather than
      // rounded away.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 100,
        lines: 95,
      },
    },
  },
});
