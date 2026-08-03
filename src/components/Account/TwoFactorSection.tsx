import React from 'react';
import { Shield, Smartphone, AlertCircle, Key, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { TwoFactorSectionProps } from './types';

function TwoFactorSectionHeader() {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-3">
        <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
          <Smartphone className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Two-Factor Authentication</h3>
      </div>
    </div>
  );
}

function TwoFactorErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start animate-fade-in">
      <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
      <span className="text-sm text-red-800 dark:text-red-300">{error}</span>
    </div>
  );
}

interface TwoFactorStatusCardProps {
  isLoading: boolean;
  onStartSetup: () => void;
  onShowDisableModal: () => void;
  twoFactorEnabled: boolean;
}

function TwoFactorStatusCard({
  isLoading,
  onShowDisableModal,
  onStartSetup,
  twoFactorEnabled,
}: TwoFactorStatusCardProps) {
  return (
    <div className="flex items-center justify-between p-4 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg">
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-lg ${
          twoFactorEnabled
            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
            : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
        }`}>
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {twoFactorEnabled ? '2FA Enabled' : '2FA Disabled'}
          </p>
          <p className="text-sm text-sanctuary-500">
            {twoFactorEnabled ? 'Your account is protected with 2FA' : 'Enable 2FA for enhanced security'}
          </p>
        </div>
      </div>
      <Button
        variant={twoFactorEnabled ? 'secondary' : 'primary'}
        onClick={twoFactorEnabled ? onShowDisableModal : onStartSetup}
        isLoading={isLoading}
      >
        {twoFactorEnabled ? 'Disable' : 'Enable 2FA'}
      </Button>
    </div>
  );
}

function BackupCodesCard({ onShowBackupCodesModal }: { onShowBackupCodesModal: () => void }) {
  return (
    <div className="flex items-center justify-between p-4 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg">
      <div className="flex items-center space-x-3">
        <div className="p-2 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500">
          <Key className="w-5 h-5" />
        </div>
        <div>
          <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">Backup Codes</p>
          <p className="text-sm text-sanctuary-500">Generate new backup codes for account recovery</p>
        </div>
      </div>
      <Button
        variant="secondary"
        onClick={onShowBackupCodesModal}
      >
        <RefreshCw className="w-4 h-4 mr-2" />
        Regenerate
      </Button>
    </div>
  );
}

export const TwoFactorSection: React.FC<TwoFactorSectionProps> = ({
  twoFactorEnabled,
  twoFactorError,
  is2FALoading,
  showSetupModal,
  showDisableModal,
  onStartSetup,
  onShowDisableModal,
  onShowBackupCodesModal,
}) => {
  const showActionLoading = is2FALoading && !showSetupModal && !showDisableModal;

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <TwoFactorSectionHeader />

      <div className="p-6 space-y-6">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          Two-factor authentication adds an extra layer of security to your account by requiring a verification code in addition to your password.
        </p>

        <TwoFactorErrorAlert error={twoFactorError} />

        <TwoFactorStatusCard
          isLoading={showActionLoading}
          onShowDisableModal={onShowDisableModal}
          onStartSetup={onStartSetup}
          twoFactorEnabled={twoFactorEnabled}
        />

        {twoFactorEnabled && (
          <BackupCodesCard onShowBackupCodesModal={onShowBackupCodesModal} />
        )}
      </div>
    </div>
  );
};
