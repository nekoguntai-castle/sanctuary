/**
 * Device API Routes Tests
 *
 * Tests for device management endpoints including:
 * - POST /devices (registration with accounts)
 * - GET /devices/:id/accounts
 * - POST /devices/:id/accounts
 * - DELETE /devices/:id/accounts/:accountId
 * - GET /devices/models (device catalog)
 * - GET /devices/models/:slug (specific model)
 * - GET /devices/manufacturers (manufacturer list)
 * - GET /devices/:id/share (sharing info)
 * - POST /devices/:id/share/user (share with user)
 * - DELETE /devices/:id/share/user/:targetUserId (remove user)
 * - POST /devices/:id/share/group (share with group)
 */

import { describe } from 'vitest';

import { registerNormalizeIncomingAccountsTests } from './devices/devices.account-conflicts.contracts';
import { registerDeviceAccountTests } from './devices/devices.accounts.contracts';
import { registerDeviceCatalogTests } from './devices/devices.catalog.contracts';
import { registerDeviceCrudTests } from './devices/devices.crud.contracts';
import { registerDeviceRegistrationTests } from './devices/devices.registration.contracts';
import { registerDeviceSharingTests } from './devices/devices.sharing.contracts';
import { setupDevicesApiTestHooks } from './devices/devicesTestHarness';

describe('Devices API', () => {
  setupDevicesApiTestHooks();
  registerDeviceRegistrationTests();
  registerDeviceAccountTests();
  registerDeviceCrudTests();
  registerDeviceCatalogTests();
  registerDeviceSharingTests();
});

registerNormalizeIncomingAccountsTests();
