import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfillsWithoutDeprecatedEsbuild } from './vite.nodePolyfills';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
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
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@shared': path.resolve(__dirname, './shared'),
        }
      },
      optimizeDeps: {
        // Pre-bundle regenerator-runtime to ensure it's available
        include: ['regenerator-runtime/runtime'],
      },
      build: {
        // Suppress chunk size warnings — further splitting attempted (commit 0ff0bc0)
        // but libraries like lucide-react, recharts, bc-ur have issues when split.
        chunkSizeWarningLimit: 5500,
        rollupOptions: {
          // Ensure regenerator-runtime is treated as external-facing code
          output: {
            // Preserve module execution order
            preserveModules: false,
            // Conservative manual chunk splitting - only proven-safe libraries
            // Previous attempt (commit 0ff0bc0) failed because:
            // - lucide-react: barrel exports don't initialize properly when split
            // - recharts: complex internal redux/d3 state
            // - @ngraveio/bc-ur + @keystonehq: circular dependencies
            manualChunks(id) {
              if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react-router-dom/')) {
                return 'vendor-react';
              }
              if (id.includes('/node_modules/@tanstack/react-query/')) {
                return 'vendor-query';
              }
            },
            // DO NOT add to chunks (known problematic):
            // - lucide-react (barrel export pattern breaks)
            // - recharts (internal redux/d3 state)
            // - @ngraveio/bc-ur, @keystonehq/* (circular deps)
            // - Hardware wallet SDKs (WASM/complex init)
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
