import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { nodePolyfillsWithoutDeprecatedEsbuild } from './vite.nodePolyfills';

const ANALYZE = process.env.ANALYZE === '1';
const repoRoot = path.resolve(__dirname, '../..');
const frontendRoot = path.join(repoRoot, 'src');
const buildOutput = path.join(repoRoot, 'dist');

export default defineConfig(() => {
    return {
      root: frontendRoot,
      envDir: repoRoot,
      publicDir: path.join(repoRoot, 'public'),
      cacheDir: path.join(repoRoot, 'node_modules/.vite'),
      server: {
        port: 3000,
        host: '0.0.0.0',
        fs: {
          allow: [repoRoot],
        },
        watch: {
          usePolling: true,
          interval: 1000,
        },
      },
      plugins: [
        react(),
        nodePolyfillsWithoutDeprecatedEsbuild({
          include: ['process', 'stream', 'util'],
          globals: {
            Buffer: 'build',
            process: 'build',
            global: 'build',
          },
        }),
        // ANALYZE=1 npm run build → writes dist/stats.html with gzip/brotli sizes.
        // Off by default so production builds stay deterministic.
        // ANALYZE=1 npm run build → writes dist/stats.html (treemap, gzip/brotli
        // sizes) and dist/stats.json (raw module → chunk attribution for
        // scripted analysis). Off by default so production builds stay
        // deterministic and don't pay the visualizer's plugin cost.
        ...(ANALYZE
          ? [
              visualizer({
                filename: path.join(buildOutput, 'stats.html'),
                gzipSize: true,
                brotliSize: true,
                template: 'treemap',
              }),
              visualizer({
                filename: path.join(buildOutput, 'stats.json'),
                template: 'raw-data',
              }),
            ]
          : []),
      ],
      resolve: {
        alias: {
          '@': path.join(repoRoot, 'src'),
          // Frontend prod build: alias the workspace package at SOURCE so
          // tree-shaking + sourcemaps stay aligned with shared/**/*.ts.
          '@sanctuary/shared': path.join(repoRoot, 'shared'),
        }
      },
      optimizeDeps: {
        // Pre-bundle regenerator-runtime to ensure it's available
        include: ['regenerator-runtime/runtime'],
      },
      build: {
        outDir: buildOutput,
        emptyOutDir: true,
        // Chunk-size warning ceiling. The largest chunk is `lib-*.js` ≈ 5.0 MB,
        // 100 % `bitbox02-api`. Per `npm run build:analyze` (2026-06) it is NOT
        // in the initial preload set — it loads only when a user actually
        // connects a BitBox02 device, via the dynamic import in
        // src/services/hardwareWallet/runtime.ts. ledger-*.js (~920 KB) and
        // trezor-*.js (~530 KB) are similarly lazy. The ceiling stays above
        // the lib chunk so the warning fires only on a real regression — i.e.
        // something *new* getting pulled into a 5+ MB chunk, or one of the
        // hardware wallet stacks growing materially past its current ceiling.
        chunkSizeWarningLimit: 5500,
        rollupOptions: {
          output: {
            // Preserve module execution order
            preserveModules: false,
            // Conservative manual chunk splitting - only proven-safe libraries.
            // Previous attempt (commit 0ff0bc0) failed because of:
            // - lucide-react: barrel exports don't initialize properly when split
            // - recharts: complex internal redux/d3 state
            // - @ngraveio/bc-ur + @keystonehq/*: circular dependencies
            // - Hardware wallet SDKs (bitbox02-api/@ledgerhq/@trezor): WASM /
            //   USB transport / complex init; relies on the dynamic-import
            //   loaders in src/services/hardwareWallet/runtime.ts.
            manualChunks(id) {
              if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react-router-dom/')) {
                return 'vendor-react';
              }
              if (id.includes('/node_modules/@tanstack/react-query/')) {
                return 'vendor-query';
              }
            },
          },
        },
        // Don't tree-shake regenerator-runtime side effects
        commonjsOptions: {
          include: [/regenerator-runtime/, /node_modules/],
          transformMixedEsModules: true,
        },
      },
    };
});
