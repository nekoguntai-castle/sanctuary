/**
 * Descriptor Parser Service Tests
 *
 * Comprehensive tests for Bitcoin descriptor parsing including:
 * - Single-sig descriptors (wpkh, pkh, sh(wpkh), tr)
 * - Multi-sig descriptors (wsh(multi), wsh(sortedmulti))
 * - Derivation path parsing (hardened/unhardened, origin info, wildcards)
 * - Checksum validation
 * - Error handling
 * - JSON import formats
 */

import { describe } from 'vitest';
import { registerDescriptorParserAutoDetectionContracts } from './descriptorParser/auto-detection.contracts';
import { registerDescriptorParserDerivationErrorContracts } from './descriptorParser/derivation-errors.contracts';
import { registerDescriptorParserJsonImportContracts } from './descriptorParser/json-import.contracts';
import { registerDescriptorParserMultiSigContracts } from './descriptorParser/multi-sig.contracts';
import { registerDescriptorParserSingleSigContracts } from './descriptorParser/single-sig.contracts';
import { registerDescriptorParserTextColdcardChecksumContracts } from './descriptorParser/text-coldcard-checksum.contracts';

describe('Descriptor Parser Service', () => {
  registerDescriptorParserSingleSigContracts();
  registerDescriptorParserMultiSigContracts();
  registerDescriptorParserDerivationErrorContracts();
  registerDescriptorParserJsonImportContracts();
  registerDescriptorParserAutoDetectionContracts();
  registerDescriptorParserTextColdcardChecksumContracts();
});
