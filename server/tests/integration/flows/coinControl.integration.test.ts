import { describe } from 'vitest';

import { registerCoinControlOptimizationEdgeContracts } from './coinControl/coinControl.optimization-edge.contracts';
import { registerCoinControlPrivacyContracts } from './coinControl/coinControl.privacy.contracts';
import { registerCoinControlSelectionContracts } from './coinControl/coinControl.selection.contracts';
import { setupCoinControlIntegrationHarness } from './coinControl/coinControlIntegrationTestHarness';

describe('Coin Control Integration Tests', () => {
  setupCoinControlIntegrationHarness();

  registerCoinControlSelectionContracts();
  registerCoinControlPrivacyContracts();
  registerCoinControlOptimizationEdgeContracts();
});
