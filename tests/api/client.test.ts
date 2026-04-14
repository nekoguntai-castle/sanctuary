/**
 * API Client Tests
 *
 * Tests for the base HTTP client: request/response handling,
 * retry with exponential backoff, auth token management, and error handling.
 */

import { afterEach, beforeEach, describe } from 'vitest';

import { registerApiClientBasicContracts } from './client/client.basic.contracts';
import { registerApiClientCookieAuthContracts } from './client/client.cookie-auth.contracts';
import { registerApiClientInitializationContracts } from './client/client.initialization.contracts';
import { registerApiClientRetryContracts } from './client/client.retry.contracts';
import { registerApiClientTransferContracts } from './client/client.transfer.contracts';
import { cleanupApiClientTest, setupApiClientTest } from './client/clientTestHarness';

describe('API Client', () => {
  beforeEach(setupApiClientTest);
  afterEach(cleanupApiClientTest);

  registerApiClientBasicContracts();
  registerApiClientRetryContracts();
  registerApiClientTransferContracts();
  registerApiClientInitializationContracts();
  registerApiClientCookieAuthContracts();
});
