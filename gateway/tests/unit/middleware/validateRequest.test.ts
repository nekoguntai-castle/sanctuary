import { describe } from 'vitest';

import {
  registerLoginValidationContracts,
  registerRefreshTokenValidationContracts,
  registerTwoFactorVerificationContracts,
  registerUserPreferencesValidationContracts,
} from './validateRequest/validateRequest.auth.contracts';
import {
  registerDeviceRequestValidationContracts,
  registerLabelValidationContracts,
  registerRoutesWithoutSchemasContracts,
} from './validateRequest/validateRequest.devices-labels-routes.contracts';
import { registerValidateFactoryContracts } from './validateRequest/validateRequest.factory.contracts';
import {
  registerMobilePermissionUpdateValidationContracts,
  registerPushRegistrationValidationContracts,
  registerPushUnregistrationValidationContracts,
} from './validateRequest/validateRequest.push-mobile.contracts';
import {
  registerLoginSchemaContracts,
  registerPushRegisterSchemaContracts,
  registerPushUnregisterSchemaContracts,
  registerRefreshTokenSchemaContracts,
  registerTwoFactorVerifySchemaContracts,
  registerUserPreferencesSchemaContracts,
} from './validateRequest/validateRequest.schema-auth.contracts';
import {
  registerDeviceSchemaContracts,
  registerDraftUpdateSchemaContracts,
  registerLabelSchemaContracts,
  registerMobilePermissionUpdateSchemaContracts,
  registerTransactionAndPsbtSchemaContracts,
} from './validateRequest/validateRequest.schema-wallet.contracts';
import { registerValidateRequestTestHarness } from './validateRequest/validateRequestTestHarness';
import {
  registerDraftUpdateValidationContracts,
  registerPsbtRequestValidationContracts,
  registerTransactionRequestValidationContracts,
} from './validateRequest/validateRequest.wallet-transactions.contracts';

describe('Request Validation Middleware', () => {
  registerValidateRequestTestHarness();

  describe('validateRequest middleware', () => {
    describe('login validation', () => {
      registerLoginValidationContracts();
    });

    describe('refresh token validation', () => {
      registerRefreshTokenValidationContracts();
    });

    describe('2FA verification validation', () => {
      registerTwoFactorVerificationContracts();
    });

    describe('user preferences validation', () => {
      registerUserPreferencesValidationContracts();
    });

    describe('push registration validation', () => {
      registerPushRegistrationValidationContracts();
    });

    describe('push unregistration validation', () => {
      registerPushUnregistrationValidationContracts();
    });

    describe('mobile permission update validation', () => {
      registerMobilePermissionUpdateValidationContracts();
    });

    describe('draft update validation', () => {
      registerDraftUpdateValidationContracts();
    });

    describe('transaction request validation', () => {
      registerTransactionRequestValidationContracts();
    });

    describe('PSBT request validation', () => {
      registerPsbtRequestValidationContracts();
    });

    describe('device request validation', () => {
      registerDeviceRequestValidationContracts();
    });

    describe('label validation', () => {
      registerLabelValidationContracts();
    });

    describe('routes without schemas', () => {
      registerRoutesWithoutSchemasContracts();
    });
  });

  describe('validate factory function', () => {
    registerValidateFactoryContracts();
  });

  describe('schema validation details', () => {
    describe('loginSchema', () => {
      registerLoginSchemaContracts();
    });

    describe('refreshTokenSchema', () => {
      registerRefreshTokenSchemaContracts();
    });

    describe('pushRegisterSchema', () => {
      registerPushRegisterSchemaContracts();
    });

    describe('pushUnregisterSchema', () => {
      registerPushUnregisterSchemaContracts();
    });

    describe('twoFactorVerifySchema', () => {
      registerTwoFactorVerifySchemaContracts();
    });

    describe('userPreferencesSchema', () => {
      registerUserPreferencesSchemaContracts();
    });

    describe('mobilePermissionUpdateSchema', () => {
      registerMobilePermissionUpdateSchemaContracts();
    });

    describe('draftUpdateSchema', () => {
      registerDraftUpdateSchemaContracts();
    });

    describe('transaction and PSBT schemas', () => {
      registerTransactionAndPsbtSchemaContracts();
    });

    describe('device schemas', () => {
      registerDeviceSchemaContracts();
    });

    describe('labelSchema', () => {
      registerLabelSchemaContracts();
    });
  });
});
