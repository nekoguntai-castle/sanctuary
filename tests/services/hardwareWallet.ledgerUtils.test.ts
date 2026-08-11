import { describe, expect, it } from 'vitest';
import { getDescriptorTemplate } from '../../src/services/hardwareWallet/adapters/ledger/utils';

describe('Ledger wallet policy utilities', () => {
  it('rejects an unknown script family instead of defaulting the device policy', () => {
    expect(() => getDescriptorTemplate('unknown-script')).toThrow(
      'Unsupported Ledger script type: unknown-script',
    );
  });
});
