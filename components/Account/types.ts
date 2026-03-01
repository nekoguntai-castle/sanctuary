export interface PasswordFormProps {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  showCurrentPassword: boolean;
  showNewPassword: boolean;
  showConfirmPassword: boolean;
  isChangingPassword: boolean;
  passwordSuccess: boolean;
  passwordError: string | null;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onToggleShowCurrentPassword: () => void;
  onToggleShowNewPassword: () => void;
  onToggleShowConfirmPassword: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export interface TwoFactorSectionProps {
  twoFactorEnabled: boolean;
  twoFactorError: string | null;
  is2FALoading: boolean;
  showSetupModal: boolean;
  showDisableModal: boolean;
  onStartSetup: () => void;
  onShowDisableModal: () => void;
  onShowBackupCodesModal: () => void;
}

export interface SetupTwoFactorModalProps {
  setupData: { secret: string; qrCodeDataUrl: string } | null;
  setupVerifyCode: string;
  backupCodes: string[];
  twoFactorError: string | null;
  is2FALoading: boolean;
  copiedCode: string | null;
  onSetupVerifyCodeChange: (value: string) => void;
  onVerifyAndEnable: () => void;
  onCopyToClipboard: (text: string, codeId: string) => void;
  onCopyAllBackupCodes: () => void;
  onClose: () => void;
}

export interface DisableTwoFactorModalProps {
  disablePassword: string;
  disableToken: string;
  twoFactorError: string | null;
  is2FALoading: boolean;
  onDisablePasswordChange: (value: string) => void;
  onDisableTokenChange: (value: string) => void;
  onDisable: () => void;
  onClose: () => void;
}

export interface BackupCodesModalProps {
  backupCodes: string[];
  disablePassword: string;
  regenerateToken: string;
  twoFactorError: string | null;
  is2FALoading: boolean;
  copiedCode: string | null;
  onDisablePasswordChange: (value: string) => void;
  onRegenerateTokenChange: (value: string) => void;
  onRegenerate: () => void;
  onCopyToClipboard: (text: string, codeId: string) => void;
  onCopyAllBackupCodes: () => void;
  onClose: () => void;
  onDone: () => void;
}

export interface BackupCodesGridProps {
  backupCodes: string[];
  copiedCode: string | null;
  codePrefix: string;
  onCopyToClipboard: (text: string, codeId: string) => void;
  onCopyAllBackupCodes: () => void;
}
