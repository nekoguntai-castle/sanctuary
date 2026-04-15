import { describe } from 'vitest';

import { registerAdminNodeConfigProxyTests } from './adminNodeConfig/adminNodeConfig.proxy.contracts';
import { registerAdminNodeConfigReadUpdateTests } from './adminNodeConfig/adminNodeConfig.read-update.contracts';
import { registerAdminNodeConfigTestEndpointTests } from './adminNodeConfig/adminNodeConfig.test-endpoint.contracts';
import { setupAdminNodeConfigRouteTests } from './adminNodeConfig/adminNodeConfigTestHarness';

describe('Admin Node Config Routes', () => {
  setupAdminNodeConfigRouteTests();
  registerAdminNodeConfigReadUpdateTests();
  registerAdminNodeConfigTestEndpointTests();
  registerAdminNodeConfigProxyTests();
});
