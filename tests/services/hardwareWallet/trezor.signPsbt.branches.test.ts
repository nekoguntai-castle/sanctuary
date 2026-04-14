import { describe } from 'vitest';

import { registerTrezorSignPsbtBranchSetup } from './trezorSignPsbtBranches/trezorSignPsbtBranchesTestHarness';
import { registerTrezorSignPsbtErrorHandlingContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.error-handling.contracts';
import { registerTrezorSignPsbtMismatchRefContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.mismatch-ref.contracts';
import { registerTrezorSignPsbtRequestPathContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.request-paths.contracts';
import { registerTrezorSignPsbtSignatureExtractionContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.signature-extraction.contracts';

describe('signPsbtWithTrezor branch coverage', () => {
  registerTrezorSignPsbtBranchSetup();
  registerTrezorSignPsbtRequestPathContracts();
  registerTrezorSignPsbtMismatchRefContracts();
  registerTrezorSignPsbtSignatureExtractionContracts();
  registerTrezorSignPsbtErrorHandlingContracts();
});
