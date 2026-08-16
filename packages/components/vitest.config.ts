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
    // `src/**` is included so a test written next to its module runs instead of
    // silently never running. Two such files had accumulated under `src/lib`,
    // one of them a diverged copy of a live suite — 16 passing tests that no
    // run had ever executed. Tests still belong in `tests/`; this only makes a
    // misplaced one fail loudly rather than look like coverage it is not.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Keep diagnostics from failing tests while avoiding the substantial I/O
    // produced by expected logs from hundreds of passing files.
    silent: 'passed-only',
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
