declare module 'bitbox02-api';
declare module 'bs58check';
declare module 'bip39';
declare module 'tiny-secp256k1';
declare module '@caravan/bitcoin';
declare module 'vite-plugin-node-polyfills/shims/buffer' {
  import { Buffer } from 'buffer';
  const BufferPolyfill: typeof Buffer;
  export default BufferPolyfill;
}
declare module 'vite-plugin-node-polyfills/shims/global' {
  const globalPolyfill: typeof globalThis;
  export default globalPolyfill;
}
declare module 'vite-plugin-node-polyfills/shims/process' {
  const processPolyfill: NodeJS.Process;
  export default processPolyfill;
}
