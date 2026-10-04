import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/fixtures/**', 'node_modules/**', 'dist/**'],
    testTimeout: 30_000,
  },
});
