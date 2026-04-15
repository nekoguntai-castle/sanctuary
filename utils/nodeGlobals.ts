/* v8 ignore start */
import BufferPolyfill from 'vite-plugin-node-polyfills/shims/buffer';
import globalPolyfill from 'vite-plugin-node-polyfills/shims/global';
import processPolyfill from 'vite-plugin-node-polyfills/shims/process';

const scope = globalThis as typeof globalThis & {
  Buffer?: typeof BufferPolyfill;
  global?: typeof globalPolyfill;
  process?: typeof processPolyfill;
};

scope.Buffer = scope.Buffer || BufferPolyfill;
scope.global = scope.global || globalPolyfill;
scope.process = scope.process || processPolyfill;
/* v8 ignore stop */
