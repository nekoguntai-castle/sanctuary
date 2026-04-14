import { describe } from 'vitest';

import { registerOpenApiAdminCoreTests } from './openapi.admin-core.contracts';
import { registerOpenApiAdminOpsTests } from './openapi.admin-ops.contracts';
import { registerOpenApiCoreTests, registerOpenApiHealthTests } from './openapi.core.contracts';
import { registerOpenApiGatewayTests } from './openapi.gateway.contracts';
import { registerOpenApiWalletPolicyTests, registerOpenApiWalletTests } from './openapi.wallet.contracts';

describe('OpenAPI Docs', () => {
  registerOpenApiCoreTests();
  registerOpenApiWalletTests();
  registerOpenApiHealthTests();
  registerOpenApiWalletPolicyTests();
  registerOpenApiAdminCoreTests();
  registerOpenApiAdminOpsTests();
  registerOpenApiGatewayTests();
});
