import { describe, expect, it } from 'vitest';
import BufferPolyfill from 'vite-plugin-node-polyfills/shims/buffer';
import globalPolyfill from 'vite-plugin-node-polyfills/shims/global';
import processPolyfill from 'vite-plugin-node-polyfills/shims/process';
import { installNodeGlobals, type NodeGlobalScope } from '../../src/utils/nodeGlobals';

describe('installNodeGlobals', () => {
  it('preserves globals supplied by the runtime', () => {
    const nativeBuffer = { source: 'runtime-buffer' } as unknown as typeof BufferPolyfill;
    const nativeGlobal = { source: 'runtime-global' } as unknown as typeof globalPolyfill;
    const nativeProcess = { source: 'runtime-process' } as unknown as typeof processPolyfill;
    const runtimeGlobals: NodeGlobalScope = {
      Buffer: nativeBuffer,
      global: nativeGlobal,
      process: nativeProcess,
    };

    installNodeGlobals(runtimeGlobals);

    expect(runtimeGlobals).toEqual({
      Buffer: nativeBuffer,
      global: nativeGlobal,
      process: nativeProcess,
    });
  });

  it('installs browser polyfills when runtime globals are absent', () => {
    const browserGlobals: NodeGlobalScope = {};

    installNodeGlobals(browserGlobals);

    expect(browserGlobals).toEqual({
      Buffer: BufferPolyfill,
      global: globalPolyfill,
      process: processPolyfill,
    });
  });
});
