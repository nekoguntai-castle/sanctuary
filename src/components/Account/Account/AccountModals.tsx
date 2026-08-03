import { BackupCodesModal } from '../BackupCodesModal';
import { DisableTwoFactorModal } from '../DisableTwoFactorModal';
import { SetupTwoFactorModal } from '../SetupTwoFactorModal';
import type { TwoFactorController } from './types';

export function AccountModals({ twoFactor }: { twoFactor: TwoFactorController }) {
  return (
    <>
      {twoFactor.showSetupModal && <SetupModal twoFactor={twoFactor} />}
      {twoFactor.showDisableModal && <DisableModal twoFactor={twoFactor} />}
      {twoFactor.showBackupCodesModal && <BackupModal twoFactor={twoFactor} />}
    </>
  );
}

function SetupModal({ twoFactor }: { twoFactor: TwoFactorController }) {
  return (
    <SetupTwoFactorModal
      setupData={twoFactor.setupData}
      setupVerifyCode={twoFactor.setupVerifyCode}
      backupCodes={twoFactor.backupCodes}
      twoFactorError={twoFactor.twoFactorError}
      is2FALoading={twoFactor.is2FALoading}
      copiedCode={twoFactor.copiedCode}
      onSetupVerifyCodeChange={twoFactor.setSetupVerifyCode}
      onVerifyAndEnable={twoFactor.verifyAndEnable}
      onCopyToClipboard={twoFactor.copyToClipboard}
      onCopyAllBackupCodes={twoFactor.copyAllBackupCodes}
      onClose={twoFactor.closeSetup}
    />
  );
}

function DisableModal({ twoFactor }: { twoFactor: TwoFactorController }) {
  return (
    <DisableTwoFactorModal
      disablePassword={twoFactor.disablePassword}
      disableToken={twoFactor.disableToken}
      twoFactorError={twoFactor.twoFactorError}
      is2FALoading={twoFactor.is2FALoading}
      onDisablePasswordChange={twoFactor.setDisablePassword}
      onDisableTokenChange={twoFactor.setDisableToken}
      onDisable={twoFactor.disableTwoFactor}
      onClose={twoFactor.closeDisable}
    />
  );
}

function BackupModal({ twoFactor }: { twoFactor: TwoFactorController }) {
  return (
    <BackupCodesModal
      backupCodes={twoFactor.backupCodes}
      disablePassword={twoFactor.disablePassword}
      regenerateToken={twoFactor.regenerateToken}
      twoFactorError={twoFactor.twoFactorError}
      is2FALoading={twoFactor.is2FALoading}
      copiedCode={twoFactor.copiedCode}
      onDisablePasswordChange={twoFactor.setDisablePassword}
      onRegenerateTokenChange={twoFactor.setRegenerateToken}
      onRegenerate={twoFactor.regenerateBackupCodes}
      onCopyToClipboard={twoFactor.copyToClipboard}
      onCopyAllBackupCodes={twoFactor.copyAllBackupCodes}
      onClose={twoFactor.closeBackupCodes}
      onDone={twoFactor.completeBackupCodes}
    />
  );
}
