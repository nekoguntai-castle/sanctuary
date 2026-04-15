/**
 * BitBox02 adapter coverage tests
 */

import { describe } from 'vitest';

import { registerBitBoxConnectionTests } from './hardwareWalletBitbox/bitboxAdapter.connection.contracts';
import { registerBitBoxSigningTests } from './hardwareWalletBitbox/bitboxAdapter.signing.contracts';
import { setupBitBoxAdapterTestHarness } from './hardwareWalletBitbox/bitboxAdapterTestHarness';
import { registerBitBoxXpubAddressTests } from './hardwareWalletBitbox/bitboxAdapter.xpub-address.contracts';

describe('BitBoxAdapter', () => {
  setupBitBoxAdapterTestHarness();
  registerBitBoxConnectionTests();
  registerBitBoxXpubAddressTests();
  registerBitBoxSigningTests();
});
