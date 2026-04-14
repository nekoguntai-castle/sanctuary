import { afterEach, beforeEach, describe } from 'vitest';

import { registerClientServerLimitAuthUpgradeContracts } from './clientServerLimits/clientServerLimits.auth-upgrade.contracts';
import { registerClientServerLimitBatchRateContracts } from './clientServerLimits/clientServerLimits.batch-rate.contracts';
import { registerClientServerLimitBroadcastStatsLifecycleContracts } from './clientServerLimits/clientServerLimits.broadcast-stats-lifecycle.contracts';
import { registerClientServerLimitMessageFlowContracts } from './clientServerLimits/clientServerLimits.message-flow.contracts';
import { registerClientServerLimitSubscriptionContracts } from './clientServerLimits/clientServerLimits.subscriptions.contracts';
import {
  cleanupClientServerLimitMocks,
  setupClientServerLimitMocks,
} from './clientServerLimits/clientServerLimitsTestHarness';

describe('SanctauryWebSocketServer limits', () => {
  beforeEach(setupClientServerLimitMocks);
  afterEach(cleanupClientServerLimitMocks);

  registerClientServerLimitBatchRateContracts();
  registerClientServerLimitAuthUpgradeContracts();
  registerClientServerLimitSubscriptionContracts();
  registerClientServerLimitBroadcastStatsLifecycleContracts();
  registerClientServerLimitMessageFlowContracts();
});
