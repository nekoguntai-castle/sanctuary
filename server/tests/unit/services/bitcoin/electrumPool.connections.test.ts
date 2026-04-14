/**
 * ElectrumPool Unit Tests
 *
 * Tests for the multi-server Electrum connection pool functionality.
 * Tests pool scaling, load balancing, and connection management.
 */

import { describe } from 'vitest';
import { registerElectrumPoolInternalConnectionTests } from './electrumPoolConnections/internal-connection-and-queue.contracts';
import { registerElectrumPoolModuleHelperTests } from './electrumPoolConnections/module-level-pool-helpers.contracts';
import {
  setupElectrumPoolConnectionTestHooks,
  type ElectrumPoolTestContext,
} from './electrumPoolConnections/electrumPoolConnectionsTestHarness';

describe('ElectrumPool', () => {
  const context: ElectrumPoolTestContext = {};

  setupElectrumPoolConnectionTestHooks(context);
  registerElectrumPoolInternalConnectionTests(context);
  registerElectrumPoolModuleHelperTests();
});
