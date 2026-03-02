import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackupCodesModal } from '../../../components/Account/BackupCodesModal';

vi.mock('../../../components/Account/BackupCodesGrid', () => ({
  BackupCodesGrid: ({
    backupCodes,
    copiedCode,
    codePrefix,
  }: {
    backupCodes: string[];
    copiedCode: string | null;
    codePrefix: string;
  }) => (
    <div data-testid="backup-grid">
      <span data-testid="backup-count">{backupCodes.length}</span>
      <span data-testid="copied-code">{copiedCode || ''}</span>
      <span data-testid="code-prefix">{codePrefix}</span>
    </div>
  ),
}));

const defaultProps = {
  backupCodes: [] as string[],
  disablePassword: '',
  regenerateToken: '',
  twoFactorError: null as string | null,
  is2FALoading: false,
  copiedCode: null as string | null,
  onDisablePasswordChange: vi.fn(),
  onRegenerateTokenChange: vi.fn(),
  onRegenerate: vi.fn(),
  onCopyToClipboard: vi.fn(),
  onCopyAllBackupCodes: vi.fn(),
  onClose: vi.fn(),
  onDone: vi.fn(),
};

describe('BackupCodesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders generated-codes flow when backup codes are provided', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onClose = vi.fn();

    render(
      <BackupCodesModal
        {...defaultProps}
        backupCodes={['11111111', '22222222']}
        copiedCode="11111111"
        onDone={onDone}
        onClose={onClose}
      />
    );

    expect(screen.getByText('New Backup Codes')).toBeInTheDocument();
    expect(screen.getByText(/your old codes are now invalid/i)).toBeInTheDocument();
    expect(screen.getByTestId('backup-count')).toHaveTextContent('2');
    expect(screen.getByTestId('copied-code')).toHaveTextContent('11111111');
    expect(screen.getByTestId('code-prefix')).toHaveTextContent('regen');

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);

    const closeButton = screen.getAllByRole('button').find(btn => btn.querySelector('svg'));
    expect(closeButton).toBeTruthy();
    if (closeButton) {
      await user.click(closeButton);
    }
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders regenerate form flow and sanitizes 2FA token input', async () => {
    const user = userEvent.setup();
    const onDisablePasswordChange = vi.fn();
    const onRegenerateTokenChange = vi.fn();
    const onRegenerate = vi.fn();

    render(
      <BackupCodesModal
        {...defaultProps}
        onDisablePasswordChange={onDisablePasswordChange}
        onRegenerateTokenChange={onRegenerateTokenChange}
        onRegenerate={onRegenerate}
        disablePassword=""
        regenerateToken=""
      />
    );

    expect(screen.getByText('Regenerate Backup Codes')).toBeInTheDocument();
    const passwordInput = screen.getByPlaceholderText('Enter your password');
    const tokenInput = screen.getByPlaceholderText('000000');

    await user.type(passwordInput, 'MySecretPass');
    expect(onDisablePasswordChange).toHaveBeenCalled();

    fireEvent.change(tokenInput, { target: { value: '12ab34567' } });
    expect(onRegenerateTokenChange).toHaveBeenLastCalledWith('123456');

    expect(screen.getByRole('button', { name: 'Generate New Codes' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onClose).toHaveBeenCalled();

    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it('shows 2FA error and enables regenerate button when password and 6-digit token are provided', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();

    render(
      <BackupCodesModal
        {...defaultProps}
        disablePassword="valid-password"
        regenerateToken="123456"
        twoFactorError="Invalid 2FA token"
        is2FALoading={false}
        onRegenerate={onRegenerate}
      />
    );

    expect(screen.getByText('Invalid 2FA token')).toBeInTheDocument();
    const generateButton = screen.getByRole('button', { name: 'Generate New Codes' });
    expect(generateButton).not.toBeDisabled();

    await user.click(generateButton);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
