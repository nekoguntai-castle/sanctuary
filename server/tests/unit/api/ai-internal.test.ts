/**
 * AI Internal API Tests
 *
 * Registrar for internal AI endpoint contract modules.
 */

import { describe } from 'vitest';
import { registerAiInternalDataContracts } from './aiInternal/aiInternal.data.contracts';
import { registerAiInternalNetworkContracts } from './aiInternal/aiInternal.network.contracts';
import { setupAiInternalApiTestHooks } from './aiInternal/aiInternalTestHarness';

describe('AI Internal API Routes', () => {
  setupAiInternalApiTestHooks();

  registerAiInternalNetworkContracts();
  registerAiInternalDataContracts();
});
