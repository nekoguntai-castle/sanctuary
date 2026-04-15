import { describe } from 'vitest';

import { registerPayjoinFlowSecurityContracts } from './payjoin/payjoin.flow-security.contracts';
import { registerPayjoinUriStructureContracts } from './payjoin/payjoin.uri-structure.contracts';
import { setupPayjoinIntegrationHarness } from './payjoin/payjoinIntegrationTestHarness';

describe('Payjoin Integration Tests', () => {
  setupPayjoinIntegrationHarness();

  registerPayjoinFlowSecurityContracts();
  registerPayjoinUriStructureContracts();
});
