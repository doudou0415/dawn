/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@dawn/core': path.resolve(__dirname, 'Dawn/packages/core/src'),
      '@dawn/core/LLMClient.js': path.resolve(__dirname, 'Dawn/packages/core/src/LLMClient.ts'),
      '@dawn/memory': path.resolve(__dirname, 'Dawn/packages/memory/src'),
      '@dawn/evolution': path.resolve(__dirname, 'Dawn/packages/evolution/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['Dawn/src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
