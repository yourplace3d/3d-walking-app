import { defineConfig } from 'vite';

export default defineConfig({
  // relative base: the build works from any static host path
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as Parameters<typeof defineConfig>[0]);
