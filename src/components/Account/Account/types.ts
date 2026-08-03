import type { User } from '../../../types';
import type { PasswordFormProps } from '../types';

export type AccountUser = User | null | undefined;

export interface TwoFactorController {
  twoFactorEnabled: boolean;
  showSetupModal: boolean;
  showDisableModal: boolean;
  showBackupCodesModal: boolean;
  setupData: { secret: string; qrCodeDataUrl: string } | null;
  setupVerifyCode: string;
  backupCodes: string[];
  disablePassword: string;
  disableToken: string;
  regenerateToken: string;
  is2FALoading: boolean;
  twoFactorError: string | null;
  copiedCode: string | null;
  setSetupVerifyCode: (value: string) => void;
  setDisablePassword: (value: string) => void;
  setDisableToken: (value: string) => void;
  setRegenerateToken: (value: string) => void;
  startSetup: () => Promise<void>;
  verifyAndEnable: () => Promise<void>;
  disableTwoFactor: () => Promise<void>;
  regenerateBackupCodes: () => Promise<void>;
  copyToClipboard: (text: string, codeId: string) => Promise<void>;
  copyAllBackupCodes: () => Promise<void>;
  showDisable: () => void;
  showBackupCodes: () => void;
  closeSetup: () => void;
  closeDisable: () => void;
  closeBackupCodes: () => void;
  completeBackupCodes: () => void;
}

export interface AccountViewProps {
  user: AccountUser;
  password: PasswordFormProps;
  twoFactor: TwoFactorController;
}
