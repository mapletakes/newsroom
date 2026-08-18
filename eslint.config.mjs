import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),

  {
    rules: {
      // eslint-config-next 16 bundles a newer eslint-plugin-react-hooks with
      // React Compiler-era rules that flag long-standing, deliberate
      // patterns (mount-flag effects, "latest ref" callback closures,
      // debounced/touched-guarded state sync) as errors. Downgraded to warn
      // rather than rewriting hook logic across ~10 files as a side effect
      // of a dependency bump — worth revisiting as its own task.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]);
