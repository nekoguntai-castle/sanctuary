import { useState } from 'react';
import * as twoFactorApi from '../../../src/api/twoFactor';
import { copyToClipboard as clipboardCopy } from '../../../utils/clipboard';
import {
  canDisableTwoFactor,
  canRegenerateBackupCodes,
  canVerifySetupCode,
  getTwoFactorErrorMessage,
} from './twoFactorHelpers';
import type { TwoFactorController } from './types';

export const useTwoFactorController = (
  initialTwoFactorEnabled: boolean
): TwoFactorController => {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(initialTwoFactorEnabled);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showBackupCodesModal, setShowBackupCodesModal] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [setupVerifyCode, setSetupVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [regenerateToken, setRegenerateToken] = useState('');
  const [is2FALoading, setIs2FALoading] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const startSetup = async () => {
    setIs2FALoading(true);
    setTwoFactorError(null);

    try {
      const data = await twoFactorApi.setup2FA();
      setSetupData(data);
      setShowSetupModal(true);
    } catch (error) {
      setTwoFactorError(getTwoFactorErrorMessage(error, 'Failed to start 2FA setup'));
    } finally {
      setIs2FALoading(false);
    }
  };

  const verifyAndEnable = async () => {
    if (!canVerifySetupCode(setupVerifyCode)) return;
    setIs2FALoading(true);
    setTwoFactorError(null);

    try {
      const result = await twoFactorApi.enable2FA(setupVerifyCode);
      setBackupCodes(result.backupCodes);
      setTwoFactorEnabled(true);
      setSetupVerifyCode('');
      setSetupData(null);
    } catch (error) {
      setTwoFactorError(getTwoFactorErrorMessage(error, 'Invalid verification code'));
    } finally {
      setIs2FALoading(false);
    }
  };

  const disableTwoFactor = async () => {
    if (!canDisableTwoFactor(disablePassword, disableToken)) return;
    setIs2FALoading(true);
    setTwoFactorError(null);

    try {
      await twoFactorApi.disable2FA({ password: disablePassword, token: disableToken });
      setTwoFactorEnabled(false);
      setShowDisableModal(false);
      setDisablePassword('');
      setDisableToken('');
    } catch (error) {
      setTwoFactorError(getTwoFactorErrorMessage(error, 'Failed to disable 2FA'));
    } finally {
      setIs2FALoading(false);
    }
  };

  const regenerateBackupCodes = async () => {
    if (!canRegenerateBackupCodes(disablePassword, regenerateToken)) return;
    setIs2FALoading(true);
    setTwoFactorError(null);

    try {
      const result = await twoFactorApi.regenerateBackupCodes({
        password: disablePassword,
        token: regenerateToken,
      });
      setBackupCodes(result.backupCodes);
      setDisablePassword('');
      setRegenerateToken('');
    } catch (error) {
      setTwoFactorError(getTwoFactorErrorMessage(error, 'Failed to regenerate backup codes'));
    } finally {
      setIs2FALoading(false);
    }
  };

  const copyToClipboard = async (text: string, codeId: string) => {
    const success = await clipboardCopy(text);
    if (success) {
      setCopiedCode(codeId);
      setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  const copyAllBackupCodes = async () => {
    const success = await clipboardCopy(backupCodes.join('\n'));
    if (success) {
      setCopiedCode('all');
      setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  const closeSetup = () => {
    setShowSetupModal(false);
    setSetupData(null);
    setSetupVerifyCode('');
    setBackupCodes([]);
    setTwoFactorError(null);
  };

  const closeDisable = () => {
    setShowDisableModal(false);
    setTwoFactorError(null);
    setDisablePassword('');
    setDisableToken('');
  };

  const closeBackupCodes = () => {
    setShowBackupCodesModal(false);
    setBackupCodes([]);
    setTwoFactorError(null);
    setDisablePassword('');
    setRegenerateToken('');
  };

  const completeBackupCodes = () => {
    setShowBackupCodesModal(false);
    setBackupCodes([]);
  };

  return {
    twoFactorEnabled,
    showSetupModal,
    showDisableModal,
    showBackupCodesModal,
    setupData,
    setupVerifyCode,
    backupCodes,
    disablePassword,
    disableToken,
    regenerateToken,
    is2FALoading,
    twoFactorError,
    copiedCode,
    setSetupVerifyCode,
    setDisablePassword,
    setDisableToken,
    setRegenerateToken,
    startSetup,
    verifyAndEnable,
    disableTwoFactor,
    regenerateBackupCodes,
    copyToClipboard,
    copyAllBackupCodes,
    showDisable: () => setShowDisableModal(true),
    showBackupCodes: () => setShowBackupCodesModal(true),
    closeSetup,
    closeDisable,
    closeBackupCodes,
    completeBackupCodes,
  };
};
