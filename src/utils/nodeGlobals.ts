import BufferPolyfill from 'vite-plugin-node-polyfills/shims/buffer';
import globalPolyfill from 'vite-plugin-node-polyfills/shims/global';
import processPolyfill from 'vite-plugin-node-polyfills/shims/process';

export interface NodeGlobalScope {
  Buffer?: typeof BufferPolyfill;
  global?: typeof globalPolyfill;
  process?: typeof processPolyfill;
}

/** Install browser-safe Node shims without replacing globals supplied by the runtime. */
export function installNodeGlobals(scope: NodeGlobalScope): void {
  scope.Buffer = scope.Buffer || BufferPolyfill;
  scope.global = scope.global || globalPolyfill;
  scope.process = scope.process || processPolyfill;
}

// Keep application startup compatible with libraries that expect Node globals.
installNodeGlobals(globalThis as NodeGlobalScope);
