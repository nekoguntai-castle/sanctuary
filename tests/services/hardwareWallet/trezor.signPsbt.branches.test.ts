import { describe } from 'vitest';

import { registerTrezorSignPsbtBranchSetup } from './trezorSignPsbtBranches/trezorSignPsbtBranchesTestHarness';
import { registerTrezorSignPsbtErrorHandlingContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.error-handling.contracts';
import { registerTrezorSignPsbtHelperContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.helpers.contracts';
import { registerTrezorSignPsbtMismatchRefContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.mismatch-ref.contracts';
import { registerTrezorSignPsbtRequestPathContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.request-paths.contracts';
import { registerTrezorSignPsbtSignatureExtractionContracts } from './trezorSignPsbtBranches/trezorSignPsbtBranches.signature-extraction.contracts';

describe('signPsbtWithTrezor branch coverage', () => {
  registerTrezorSignPsbtBranchSetup();
  registerTrezorSignPsbtHelperContracts();
  registerTrezorSignPsbtRequestPathContracts();
  registerTrezorSignPsbtMismatchRefContracts();
  registerTrezorSignPsbtSignatureExtractionContracts();
  registerTrezorSignPsbtErrorHandlingContracts();
});
