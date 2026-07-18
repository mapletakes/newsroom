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
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    // Component/integration tests need a DOM; pure lib tests stay on the
    // faster 'node' environment (the default above) rather than switching
    // everything to jsdom globally.
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
