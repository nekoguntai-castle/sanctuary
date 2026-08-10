import { beforeEach, describe, expect, it, vi } from 'vitest';

const decodeState = vi.hoisted(() => ({ bytes: new Uint8Array(78) }));

vi.mock('bs58check', () => ({
  default: {
    decode: vi.fn(() => decodeState.bytes),
  },
}));

import { parseCanonicalDescriptor } from '../../../../src/services/bitcoin/descriptorParser/canonicalDescriptor';

const XPUB_VERSION = 0x0488b21e;
const HARDENED_ACCOUNT_ZERO = 0x80000000;
const descriptor = 'wpkh([aabbccdd/84h/0h/0h]xpubMockSerializationEnvelope/0/*)';

const envelope = (overrides: { version?: number; depth?: number; parent?: number; child?: number } = {}) => {
  const bytes = new Uint8Array(78);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, overrides.version ?? XPUB_VERSION);
  bytes[4] = overrides.depth ?? 3;
  view.setUint32(5, overrides.parent ?? 0xaabbccdd);
  view.setUint32(9, overrides.child ?? HARDENED_ACCOUNT_ZERO);
  bytes[45] = 2;
  return bytes;
};

describe('canonical descriptor serialized-key envelope checks', () => {
  beforeEach(() => {
    decodeState.bytes = envelope();
  });

  it('rejects a decoded version that contradicts the textual key prefix', () => {
    decodeState.bytes = envelope({ version: 0x043587cf });
    expect(() => parseCanonicalDescriptor(descriptor))
      .toThrow('Extended public key version does not match its prefix');
  });

  it('rejects a decoded depth that contradicts the declared account origin', () => {
    decodeState.bytes = envelope({ depth: 2 });
    expect(() => parseCanonicalDescriptor(descriptor))
      .toThrow('Extended public key depth does not match descriptor origin');
  });

  it('rejects an unbound root-parent sentinel in an account xpub envelope', () => {
    decodeState.bytes = envelope({ parent: 0 });
    expect(() => parseCanonicalDescriptor(descriptor))
      .toThrow('Extended public key parent fingerprint must be nonzero');
  });
});
