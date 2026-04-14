import { describe } from 'vitest';

import { registerPushDeviceDeleteContracts } from './push/push.device-delete.contracts';
import { registerPushDevicesListContracts } from './push/push.devices-list.contracts';
import { registerPushGatewayAuditErrorsContracts } from './push/push.gateway-audit-errors.contracts';
import { registerPushGatewayAuditEventsContracts } from './push/push.gateway-audit-events.contracts';
import { registerPushGatewayByUserContracts } from './push/push.gateway-by-user.contracts';
import { registerPushGatewayDeviceContracts } from './push/push.gateway-device.contracts';
import { registerPushRegisterSuccessContracts } from './push/push.register-success.contracts';
import { registerPushRegisterValidationContracts } from './push/push.register-validation.contracts';
import { registerPushRoutesTestHarness } from './push/pushTestHarness';
import { registerPushUnregisterContracts } from './push/push.unregister.contracts';

describe('Push API Routes', () => {
  registerPushRoutesTestHarness();

  describe('POST /api/v1/push/register', () => {
    registerPushRegisterSuccessContracts();
    registerPushRegisterValidationContracts();
  });

  describe('DELETE /api/v1/push/unregister', () => {
    registerPushUnregisterContracts();
  });

  describe('GET /api/v1/push/devices', () => {
    registerPushDevicesListContracts();
  });

  describe('DELETE /api/v1/push/devices/:id', () => {
    registerPushDeviceDeleteContracts();
  });

  describe('GET /api/v1/push/by-user/:userId (Gateway Internal)', () => {
    registerPushGatewayByUserContracts();
  });

  describe('DELETE /api/v1/push/device/:deviceId (Gateway Internal)', () => {
    registerPushGatewayDeviceContracts();
  });

  describe('POST /api/v1/push/gateway-audit (Gateway Internal)', () => {
    registerPushGatewayAuditEventsContracts();
    registerPushGatewayAuditErrorsContracts();
  });
});
