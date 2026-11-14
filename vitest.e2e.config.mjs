import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.mjs'],
    environment: 'node',
    testTimeout: 90000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
