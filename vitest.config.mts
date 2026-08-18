import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Next.js's own tsconfig uses "jsx": "preserve" (its SWC pipeline handles
  // the actual transform); Vitest runs outside that pipeline, so component
  // tests need their own JSX transform — this plugin is scoped to tests
  // only and doesn't touch the app's real Next.js build.
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['node_modules/**', '.next/**'],
    // Component/integration tests need a DOM; pure lib tests stay on the
    // faster 'node' environment rather than switching everything to jsdom
    // globally. (environmentMatchGlobs was removed in Vitest 4 — projects
    // is the replacement for per-glob environment config.)
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'jsdom', environment: 'jsdom', include: ['**/*.test.tsx'] },
      },
    ],
  },
});
