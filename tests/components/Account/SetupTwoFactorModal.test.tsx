import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupTwoFactorModal } from '../../../components/Account/SetupTwoFactorModal';

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
  setupData: { secret: 'SECRET123', qrCodeDataUrl: 'data:image/png;base64,mock' },
  setupVerifyCode: '',
  backupCodes: [] as string[],
  twoFactorError: null as string | null,
  is2FALoading: false,
  copiedCode: null as string | null,
  onSetupVerifyCodeChange: vi.fn(),
  onVerifyAndEnable: vi.fn(),
  onCopyToClipboard: vi.fn(),
  onCopyAllBackupCodes: vi.fn(),
  onClose: vi.fn(),
};

describe('SetupTwoFactorModal', () => {
  it('renders setup flow, sanitizes verification input, and copies secret', async () => {
    const user = userEvent.setup();
    const onSetupVerifyCodeChange = vi.fn();
    const onCopyToClipboard = vi.fn();
    const onVerifyAndEnable = vi.fn();

    render(
      <SetupTwoFactorModal
        {...defaultProps}
        onSetupVerifyCodeChange={onSetupVerifyCodeChange}
        onCopyToClipboard={onCopyToClipboard}
        onVerifyAndEnable={onVerifyAndEnable}
      />
    );

    expect(screen.getByText('Set Up Two-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByAltText('2FA QR Code')).toBeInTheDocument();
    expect(screen.getByText('SECRET123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify and Enable 2FA' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '12ab34567' } });
    expect(onSetupVerifyCodeChange).toHaveBeenLastCalledWith('123456');

    await user.click(screen.getByRole('button', { name: /secret123/i }));
    expect(onCopyToClipboard).toHaveBeenCalledWith('SECRET123', 'secret');

    expect(onVerifyAndEnable).not.toHaveBeenCalled();
  });

  it('shows setup error state and allows verify action once code length is valid', async () => {
    const user = userEvent.setup();
    const onVerifyAndEnable = vi.fn();

    render(
      <SetupTwoFactorModal
        {...defaultProps}
        setupVerifyCode="123456"
        twoFactorError="Invalid verification code"
        onVerifyAndEnable={onVerifyAndEnable}
      />
    );

    expect(screen.getByText('Invalid verification code')).toBeInTheDocument();
    const verifyButton = screen.getByRole('button', { name: 'Verify and Enable 2FA' });
    expect(verifyButton).not.toBeDisabled();
    await user.click(verifyButton);
    expect(onVerifyAndEnable).toHaveBeenCalledTimes(1);
  });

  it('renders backup-codes completion flow and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <SetupTwoFactorModal
        {...defaultProps}
        setupData={null}
        backupCodes={['11111111', '22222222']}
        copiedCode="code-1"
        onClose={onClose}
      />
    );

    expect(screen.getByText('Save Backup Codes')).toBeInTheDocument();
    expect(screen.getByText(/you won't be able to see them again/i)).toBeInTheDocument();
    expect(screen.getByTestId('backup-count')).toHaveTextContent('2');
    expect(screen.getByTestId('copied-code')).toHaveTextContent('code-1');
    expect(screen.getByTestId('code-prefix')).toHaveTextContent('code');

    await user.click(screen.getByRole('button', { name: "I've Saved My Codes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows copied-secret success icon state when secret has been copied', () => {
    render(
      <SetupTwoFactorModal
        {...defaultProps}
        copiedCode="secret"
      />
    );

    const secretButton = screen.getByRole('button', { name: /secret123/i });
    const icon = secretButton.querySelector('svg');
    expect(icon?.getAttribute('class') || '').toContain('text-green-500');
  });
});
