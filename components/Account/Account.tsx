import React, { useState } from 'react';
import { useUser } from '../../contexts/UserContext';
import { UserCircle, Mail, Shield } from 'lucide-react';
import * as authApi from '../../src/api/auth';
import * as twoFactorApi from '../../src/api/twoFactor';
import { ApiError } from '../../src/api/client';
import { createLogger } from '../../utils/logger';
import { copyToClipboard as clipboardCopy } from '../../utils/clipboard';
import { PasswordForm } from './PasswordForm';
import { TwoFactorSection } from './TwoFactorSection';
import { SetupTwoFactorModal } from './SetupTwoFactorModal';
import { DisableTwoFactorModal } from './DisableTwoFactorModal';
import { BackupCodesModal } from './BackupCodesModal';

const log = createLogger('Account');

export const Account: React.FC = () => {
  const { user } = useUser();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(user?.twoFactorEnabled || false);
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

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    // Validation
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setIsChangingPassword(true);

    try {
      await authApi.changePassword({
        currentPassword,
        newPassword,
      });

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      log.error('Password change error', { error: err });
      const message = err instanceof ApiError ? err.message : 'Failed to change password';
      setPasswordError(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  // 2FA Handlers
  const handleStartSetup = async () => {
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      const data = await twoFactorApi.setup2FA();
      setSetupData(data);
      setShowSetupModal(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to start 2FA setup';
      setTwoFactorError(message);
    } finally {
      setIs2FALoading(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    if (setupVerifyCode.length < 6) return;
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      const result = await twoFactorApi.enable2FA(setupVerifyCode);
      setBackupCodes(result.backupCodes);
      setTwoFactorEnabled(true);
      setSetupVerifyCode('');
      setSetupData(null);
      // Keep modal open to show backup codes
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Invalid verification code';
      setTwoFactorError(message);
    } finally {
      setIs2FALoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!disablePassword || !disableToken) return;
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      await twoFactorApi.disable2FA({ password: disablePassword, token: disableToken });
      setTwoFactorEnabled(false);
      setShowDisableModal(false);
      setDisablePassword('');
      setDisableToken('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to disable 2FA';
      setTwoFactorError(message);
    } finally {
      setIs2FALoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!disablePassword || !regenerateToken) return;
    setIs2FALoading(true);
    setTwoFactorError(null);
    try {
      const result = await twoFactorApi.regenerateBackupCodes({ password: disablePassword, token: regenerateToken });
      setBackupCodes(result.backupCodes);
      setDisablePassword('');
      setRegenerateToken('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to regenerate backup codes';
      setTwoFactorError(message);
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

  const closeSetupModal = () => {
    setShowSetupModal(false);
    setSetupData(null);
    setSetupVerifyCode('');
    setBackupCodes([]);
    setTwoFactorError(null);
  };

  const closeDisableModal = () => {
    setShowDisableModal(false);
    setTwoFactorError(null);
    setDisablePassword('');
    setDisableToken('');
  };

  const closeBackupCodesModal = () => {
    setShowBackupCodesModal(false);
    setBackupCodes([]);
    setTwoFactorError(null);
    setDisablePassword('');
    setRegenerateToken('');
  };

  const handleBackupCodesDone = () => {
    setShowBackupCodesModal(false);
    setBackupCodes([]);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Account Settings</h2>
        <p className="text-sanctuary-500">Manage your account information and security</p>
      </div>

      {/* Account Information */}
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <UserCircle className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Profile Information</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username</label>
            <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 font-mono">
              {user?.username}
            </div>
          </div>

          {user?.email && (
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email</label>
              <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 font-mono flex items-center">
                <Mail className="w-4 h-4 mr-2 text-sanctuary-400" />
                {user.email}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Account Type</label>
            <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
              <Shield className={`w-4 h-4 mr-2 ${user?.isAdmin ? 'text-primary-600' : 'text-sanctuary-400'}`} />
              {user?.isAdmin ? 'Administrator' : 'Standard User'}
            </div>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <PasswordForm
        currentPassword={currentPassword}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        showCurrentPassword={showCurrentPassword}
        showNewPassword={showNewPassword}
        showConfirmPassword={showConfirmPassword}
        isChangingPassword={isChangingPassword}
        passwordSuccess={passwordSuccess}
        passwordError={passwordError}
        onCurrentPasswordChange={setCurrentPassword}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onToggleShowCurrentPassword={() => setShowCurrentPassword(!showCurrentPassword)}
        onToggleShowNewPassword={() => setShowNewPassword(!showNewPassword)}
        onToggleShowConfirmPassword={() => setShowConfirmPassword(!showConfirmPassword)}
        onSubmit={handlePasswordChange}
      />

      {/* Two-Factor Authentication */}
      <TwoFactorSection
        twoFactorEnabled={twoFactorEnabled}
        twoFactorError={twoFactorError}
        is2FALoading={is2FALoading}
        showSetupModal={showSetupModal}
        showDisableModal={showDisableModal}
        onStartSetup={handleStartSetup}
        onShowDisableModal={() => setShowDisableModal(true)}
        onShowBackupCodesModal={() => setShowBackupCodesModal(true)}
      />

      {/* 2FA Setup Modal */}
      {showSetupModal && (
        <SetupTwoFactorModal
          setupData={setupData}
          setupVerifyCode={setupVerifyCode}
          backupCodes={backupCodes}
          twoFactorError={twoFactorError}
          is2FALoading={is2FALoading}
          copiedCode={copiedCode}
          onSetupVerifyCodeChange={setSetupVerifyCode}
          onVerifyAndEnable={handleVerifyAndEnable}
          onCopyToClipboard={copyToClipboard}
          onCopyAllBackupCodes={copyAllBackupCodes}
          onClose={closeSetupModal}
        />
      )}

      {/* Disable 2FA Modal */}
      {showDisableModal && (
        <DisableTwoFactorModal
          disablePassword={disablePassword}
          disableToken={disableToken}
          twoFactorError={twoFactorError}
          is2FALoading={is2FALoading}
          onDisablePasswordChange={setDisablePassword}
          onDisableTokenChange={setDisableToken}
          onDisable={handleDisable2FA}
          onClose={closeDisableModal}
        />
      )}

      {/* Regenerate Backup Codes Modal */}
      {showBackupCodesModal && (
        <BackupCodesModal
          backupCodes={backupCodes}
          disablePassword={disablePassword}
          regenerateToken={regenerateToken}
          twoFactorError={twoFactorError}
          is2FALoading={is2FALoading}
          copiedCode={copiedCode}
          onDisablePasswordChange={setDisablePassword}
          onRegenerateTokenChange={setRegenerateToken}
          onRegenerate={handleRegenerateBackupCodes}
          onCopyToClipboard={copyToClipboard}
          onCopyAllBackupCodes={copyAllBackupCodes}
          onClose={closeBackupCodesModal}
          onDone={handleBackupCodesDone}
        />
      )}
    </div>
  );
};
