import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/services/bitcoin/descriptorParser/canonicalDescriptor', () => ({
  parseCanonicalDescriptor: vi.fn(() => { throw 'parser dependency failed'; }),
  expandCanonicalMultipathDescriptor: vi.fn(),
  validateCanonicalDescriptorPair: vi.fn(() => { throw 'parser dependency failed'; }),
}));

import { prepareDescriptorPolicy } from '../../../../src/services/wallet/descriptorPolicy';

describe('descriptor policy parser boundary', () => {
  it('normalizes non-Error parser failures without leaking dependency values', () => {
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: 'wpkh(mock)',
      changeDescriptor: 'wpkh(mock-change)',
      sourceKind: 'imported',
    })).toThrow('Invalid descriptor policy');
  });
});
