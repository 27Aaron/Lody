import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import { loroCrdtWasmUrlWorkaround, VITEST_INLINE_WASM_DEPS } from './vite-wasm-workarounds';

export default defineConfig({
  define: {
    'import.meta.env.VITE_PREVIEW_PUBLIC_BASE_DOMAIN': JSON.stringify('mylody.app'),
  },
  plugins: [loroCrdtWasmUrlWorkaround(), tsconfigPaths(), wasm(), topLevelAwait()],
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // This suite has hundreds of small files. Reusing worker threads avoids a
    // child-process startup per file; two workers also outperformed four on CI-sized hosts.
    pool: 'threads',
    maxWorkers: 2,
    server: {
      deps: {
        inline: VITEST_INLINE_WASM_DEPS,
      },
    },
  },
});
