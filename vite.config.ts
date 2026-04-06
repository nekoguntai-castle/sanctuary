import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

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
        nodePolyfills({
          include: ['buffer', 'process', 'stream', 'util'],
          globals: {
            Buffer: true,
            process: true,
            global: true,
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
        rolldownOptions: {
          output: {
            // Conservative manual chunk splitting - only proven-safe libraries
            // Previous attempt (commit 0ff0bc0) failed because:
            // - lucide-react: barrel exports don't initialize properly when split
            // - recharts: complex internal redux/d3 state
            // - @ngraveio/bc-ur + @keystonehq: circular dependencies
            manualChunks(id) {
              // React core - designed for code splitting, very safe
              if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/') || id.includes('/react-router/')) {
                return 'vendor-react';
              }
              // Data fetching - standalone, no complex init
              if (id.includes('/@tanstack/react-query/')) {
                return 'vendor-query';
              }
              // DO NOT add to chunks (known problematic):
              // - lucide-react (barrel export pattern breaks)
              // - recharts (internal redux/d3 state)
              // - @ngraveio/bc-ur, @keystonehq/* (circular deps)
              // - Hardware wallet SDKs (WASM/complex init)
            },
          },
        },
      },
    };
});
