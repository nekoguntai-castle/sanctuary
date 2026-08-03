import { PasswordForm } from '../PasswordForm';
import { TwoFactorSection } from '../TwoFactorSection';
import { AccountModals } from './AccountModals';
import { ProfileInformation } from './ProfileInformation';
import type { AccountViewProps } from './types';

export function AccountView({ user, password, twoFactor }: AccountViewProps) {
  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <AccountHeader />
      <ProfileInformation user={user} />
      <PasswordForm {...password} />
      <TwoFactorSection
        twoFactorEnabled={twoFactor.twoFactorEnabled}
        twoFactorError={twoFactor.twoFactorError}
        is2FALoading={twoFactor.is2FALoading}
        showSetupModal={twoFactor.showSetupModal}
        showDisableModal={twoFactor.showDisableModal}
        onStartSetup={twoFactor.startSetup}
        onShowDisableModal={twoFactor.showDisable}
        onShowBackupCodesModal={twoFactor.showBackupCodes}
      />
      <AccountModals twoFactor={twoFactor} />
    </div>
  );
}

function AccountHeader() {
  return (
    <div>
      <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Account Settings</h2>
      <p className="text-sanctuary-500">Manage your account information and security</p>
    </div>
  );
}
