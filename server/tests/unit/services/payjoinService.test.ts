/**
 * Payjoin Service Tests (CRITICAL)
 *
 * Tests for BIP78 Payjoin protocol implementation:
 * - parseBip21Uri() - Standard BIP21, pj= param extraction, amount conversion
 * - generateBip21Uri() - Correct URI format, URL encoding
 * - selectContributionUtxo() - UTXO selection within 0.5x-2x range, dust avoidance
 * - processPayjoinRequest() - Valid flow, error handling
 * - attemptPayjoinSend() - HTTP handling, proposal validation
 *
 * These tests are SECURITY-CRITICAL for Bitcoin wallet privacy.
 */

import { beforeEach, describe } from 'vitest';

import { registerPayjoinBip21Contracts } from './payjoinService/payjoinService.bip21.contracts';
import { registerPayjoinProcessContracts } from './payjoinService/payjoinService.process.contracts';
import { registerPayjoinSendAndSsrfContracts } from './payjoinService/payjoinService.send-ssrf.contracts';
import { registerPayjoinUtxoContracts } from './payjoinService/payjoinService.utxo.contracts';
import { setupPayjoinServiceTest } from './payjoinService/payjoinServiceTestHarness';

describe('Payjoin Service', () => {
  beforeEach(setupPayjoinServiceTest);

  registerPayjoinBip21Contracts();
  registerPayjoinProcessContracts();
  registerPayjoinSendAndSsrfContracts();
  registerPayjoinUtxoContracts();
});
