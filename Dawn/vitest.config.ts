import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@dawn/core': path.resolve(__dirname, 'packages/core/src'),
      '@dawn/core/LLMClient.js': path.resolve(__dirname, 'packages/core/src/LLMClient.ts'),
      '@dawn/memory': path.resolve(__dirname, 'packages/memory/src'),
      '@dawn/evolution': path.resolve(__dirname, 'packages/evolution/src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    mockReset: true,
  },
});
