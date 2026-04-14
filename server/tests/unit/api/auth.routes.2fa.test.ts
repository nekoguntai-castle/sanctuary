import { describe } from 'vitest';

import {
  registerTwoFactorBackupCodeCountContracts,
  registerTwoFactorBackupCodeRegenerateContracts,
} from './auth2fa/auth2fa.backup-codes.contracts';
import { registerTwoFactorDisableContracts } from './auth2fa/auth2fa.disable.contracts';
import {
  registerTwoFactorEnableContracts,
  registerTwoFactorSetupContracts,
} from './auth2fa/auth2fa.setup-enable.contracts';
import { registerTwoFactorVerifyContracts } from './auth2fa/auth2fa.verify.contracts';
import { registerAuth2faTestHarness } from './auth2fa/auth2faTestHarness';

describe('Auth API Routes — Two-Factor Authentication', () => {
  registerAuth2faTestHarness();

  describe('POST /auth/2fa/setup - Setup 2FA', () => {
    registerTwoFactorSetupContracts();
  });

  describe('POST /auth/2fa/enable - Enable 2FA', () => {
    registerTwoFactorEnableContracts();
  });

  describe('POST /auth/2fa/disable - Disable 2FA', () => {
    registerTwoFactorDisableContracts();
  });

  describe('POST /auth/2fa/verify - Verify 2FA During Login', () => {
    registerTwoFactorVerifyContracts();
  });

  describe('POST /auth/2fa/backup-codes - Get Backup Code Count', () => {
    registerTwoFactorBackupCodeCountContracts();
  });

  describe('POST /auth/2fa/backup-codes/regenerate - Regenerate Backup Codes', () => {
    registerTwoFactorBackupCodeRegenerateContracts();
  });
});
