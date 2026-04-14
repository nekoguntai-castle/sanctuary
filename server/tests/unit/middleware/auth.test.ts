import { describe } from 'vitest';

import { registerAuthTestSetup } from './auth/authTestHarness';
import { registerAuthenticateMiddlewareContracts } from './auth/auth.authenticate.contracts';
import { registerAuthIntegrationScenarioContracts } from './auth/auth.integration.contracts';
import { registerOptionalAuthMiddlewareContracts } from './auth/auth.optional.contracts';
import { registerRequireAdminMiddlewareContracts } from './auth/auth.require-admin.contracts';

describe('Authentication Middleware', () => {
  registerAuthTestSetup();
  registerAuthenticateMiddlewareContracts();
  registerRequireAdminMiddlewareContracts();
  registerOptionalAuthMiddlewareContracts();
  registerAuthIntegrationScenarioContracts();
});
