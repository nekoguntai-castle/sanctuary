import { describe } from 'vitest';

import { registerAdvancedTxTestSetup } from './advancedTx/advancedTxTestHarness';
import { registerBatchFeeAndConstantContracts } from './advancedTx/advancedTx.batch-fees.contracts';
import { registerCpfpContracts } from './advancedTx/advancedTx.cpfp.contracts';
import { registerRbfDetectionContracts } from './advancedTx/advancedTx.rbf-detection.contracts';
import { registerRbfTransactionCreationContracts } from './advancedTx/advancedTx.rbf-creation.contracts';

describe('Advanced Transaction Features', () => {
  registerAdvancedTxTestSetup();
  registerRbfDetectionContracts();
  registerRbfTransactionCreationContracts();
  registerCpfpContracts();
  registerBatchFeeAndConstantContracts();
});
