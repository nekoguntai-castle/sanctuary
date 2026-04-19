import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { Account } from '../../components/Account';
import { ApiError } from '../../src/api/client';

const mockState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    isAdmin: false,
    twoFactorEnabled: false,
  } as any,
  changePassword: vi.fn(),
  setup2FA: vi.fn(),
  enable2FA: vi.fn(),
  disable2FA: vi.fn(),
  regenerateBackupCodes: vi.fn(),
  copyToClipboard: vi.fn(),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockState.user,
    updateUser: vi.fn(),
  }),
}));

vi.mock('../../src/api/auth', () => ({
  changePassword: (...args: unknown[]) => mockState.changePassword(...args),
}));

vi.mock('../../src/api/twoFactor', () => ({
  setup2FA: (...args: unknown[]) => mockState.setup2FA(...args),
  enable2FA: (...args: unknown[]) => mockState.enable2FA(...args),
  disable2FA: (...args: unknown[]) => mockState.disable2FA(...args),
  regenerateBackupCodes: (...args: unknown[]) => mockState.regenerateBackupCodes(...args),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => mockState.copyToClipboard(...args),
}));

vi.mock('../../components/Account/PasswordForm', () => ({
  PasswordForm: ({ passwordError, passwordSuccess, onToggleShowCurrentPassword, onToggleShowNewPassword, onToggleShowConfirmPassword }: any) => (
    <div>
      <button type="button" onClick={onToggleShowCurrentPassword}>toggle-current-password</button>
      <button type="button" onClick={onToggleShowNewPassword}>toggle-new-password</button>
      <button type="button" onClick={onToggleShowConfirmPassword}>toggle-confirm-password</button>
      {passwordError && <p>{passwordError}</p>}
      {passwordSuccess && <p>Password changed successfully</p>}
    </div>
  ),
}));

vi.mock('../../components/Account/TwoFactorSection', () => ({
  TwoFactorSection: (props: any) => (
    <div>
      <button type="button" onClick={props.onStartSetup}>start-setup</button>
      <button type="button" onClick={props.onShowDisableModal}>open-disable</button>
      <button type="button" onClick={props.onShowBackupCodesModal}>open-backup</button>
      {props.twoFactorError && <p>{props.twoFactorError}</p>}
      <span>{props.twoFactorEnabled ? '2fa-on' : '2fa-off'}</span>
    </div>
  ),
}));

vi.mock('../../components/Account/SetupTwoFactorModal', () => ({
  SetupTwoFactorModal: (props: any) => (
    <div data-testid="setup-modal">
      <button type="button" onClick={() => props.onSetupVerifyCodeChange('12345')}>set-short-code</button>
      <button type="button" onClick={() => props.onSetupVerifyCodeChange('123456')}>set-valid-code</button>
      <button type="button" onClick={props.onVerifyAndEnable}>verify-enable</button>
      <button type="button" onClick={() => props.onCopyToClipboard('CODE1111', 'code-1')}>copy-code</button>
      <button type="button" onClick={props.onCopyAllBackupCodes}>copy-all</button>
      <button type="button" onClick={props.onClose}>close-setup</button>
      <div data-testid="setup-copied-code">{props.copiedCode ?? ''}</div>
      {props.backupCodes?.map((code: string) => (
        <div key={code}>{code}</div>
      ))}
      {props.twoFactorError && <p>{props.twoFactorError}</p>}
    </div>
  ),
}));

vi.mock('../../components/Account/DisableTwoFactorModal', () => ({
  DisableTwoFactorModal: (props: any) => (
    <div data-testid="disable-modal">
      <button type="button" onClick={() => props.onDisablePasswordChange('account-pass')}>set-disable-password</button>
      <button type="button" onClick={() => props.onDisableTokenChange('ABC123')}>set-disable-token</button>
      <button type="button" onClick={props.onDisable}>disable-2fa</button>
      <button type="button" onClick={props.onClose}>close-disable</button>
      {props.twoFactorError && <p>{props.twoFactorError}</p>}
    </div>
  ),
}));

vi.mock('../../components/Account/BackupCodesModal', () => ({
  BackupCodesModal: (props: any) => (
    <div data-testid="backup-codes-modal">
      <button type="button" onClick={() => props.onDisablePasswordChange('account-pass')}>set-regen-password</button>
      <button type="button" onClick={() => props.onRegenerateTokenChange('123456')}>set-regen-token</button>
      <button type="button" onClick={props.onRegenerate}>regenerate-codes</button>
      <button type="button" onClick={() => props.onCopyToClipboard('CODE1111', 'code-1')}>copy-code-backup</button>
      <button type="button" onClick={props.onCopyAllBackupCodes}>copy-all-backup</button>
      <button type="button" onClick={props.onDone}>done-backup</button>
      <button type="button" onClick={props.onClose}>close-backup</button>
      <div data-testid="backup-copied-code">{props.copiedCode ?? ''}</div>
      {props.backupCodes?.map((code: string) => (
        <div key={code}>{code}</div>
      ))}
      {props.twoFactorError && <p>{props.twoFactorError}</p>}
    </div>
  ),
}));

describe('Account branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.user = {
      id: 'user-1',
      username: 'tester',
      email: 'tester@example.com',
      isAdmin: false,
      twoFactorEnabled: false,
    };
    mockState.setup2FA.mockResolvedValue({
      secret: 'SECRET',
      qrCodeDataUrl: 'data:image/png;base64,abc',
    });
    mockState.enable2FA.mockResolvedValue({
      backupCodes: ['CODE1111', 'CODE2222'],
    });
    mockState.copyToClipboard.mockResolvedValue(true);
  });

  it('covers administrator account type rendering branch', () => {
    mockState.user = {
      ...mockState.user,
      isAdmin: true,
    };

    render(<Account />);

    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });

  it('omits the email field when the account has no email', () => {
    mockState.user = {
      ...mockState.user,
      email: undefined,
    };

    render(<Account />);

    expect(screen.queryByText('tester@example.com')).not.toBeInTheDocument();
  });

  it('covers setup fallback error, short-code guard, and verify ApiError branch', async () => {
    const user = userEvent.setup();
    mockState.setup2FA.mockRejectedValueOnce(new Error('network failure'));

    render(<Account />);

    await user.click(screen.getByRole('button', { name: 'start-setup' }));
    expect(await screen.findByText('Failed to start 2FA setup')).toBeInTheDocument();

    mockState.setup2FA.mockResolvedValueOnce({
      secret: 'SECRET2',
      qrCodeDataUrl: 'data:image/png;base64,def',
    });
    await user.click(screen.getByRole('button', { name: 'start-setup' }));

    await user.click(screen.getByRole('button', { name: 'set-short-code' }));
    await user.click(screen.getByRole('button', { name: 'verify-enable' }));
    expect(mockState.enable2FA).not.toHaveBeenCalled();

    mockState.enable2FA.mockRejectedValueOnce(new ApiError('Invalid code from server', 400));
    await user.click(screen.getByRole('button', { name: 'set-valid-code' }));
    await user.click(screen.getByRole('button', { name: 'verify-enable' }));

    await waitFor(() => {
      expect(mockState.enable2FA).toHaveBeenCalledWith('123456');
    });
    expect((await screen.findAllByText('Invalid code from server')).length).toBeGreaterThan(0);
  });

  it('covers disable 2FA guard plus ApiError and fallback error branches', async () => {
    const user = userEvent.setup();
    render(<Account />);

    await user.click(screen.getByRole('button', { name: 'open-disable' }));
    await user.click(screen.getByRole('button', { name: 'disable-2fa' }));
    expect(mockState.disable2FA).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'set-disable-password' }));
    await user.click(screen.getByRole('button', { name: 'set-disable-token' }));

    mockState.disable2FA
      .mockRejectedValueOnce(new ApiError('Wrong disable token', 400))
      .mockRejectedValueOnce(new Error('service down'));

    await user.click(screen.getByRole('button', { name: 'disable-2fa' }));
    expect((await screen.findAllByText('Wrong disable token')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'disable-2fa' }));
    expect((await screen.findAllByText('Failed to disable 2FA')).length).toBeGreaterThan(0);
  });

  it('covers regenerate guard plus ApiError and fallback error branches', async () => {
    const user = userEvent.setup();
    render(<Account />);

    await user.click(screen.getByRole('button', { name: 'open-backup' }));
    await user.click(screen.getByRole('button', { name: 'regenerate-codes' }));
    expect(mockState.regenerateBackupCodes).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'set-regen-password' }));
    await user.click(screen.getByRole('button', { name: 'set-regen-token' }));

    mockState.regenerateBackupCodes
      .mockRejectedValueOnce(new ApiError('Bad regenerate token', 400))
      .mockRejectedValueOnce(new Error('network error'));

    await user.click(screen.getByRole('button', { name: 'regenerate-codes' }));
    expect((await screen.findAllByText('Bad regenerate token')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'regenerate-codes' }));
    expect((await screen.findAllByText('Failed to regenerate backup codes')).length).toBeGreaterThan(0);
  });

  it('does not mark copied state when clipboard operations fail', async () => {
    const user = userEvent.setup();
    mockState.copyToClipboard.mockResolvedValue(false);

    render(<Account />);

    await user.click(screen.getByRole('button', { name: 'start-setup' }));
    await user.click(screen.getByRole('button', { name: 'set-valid-code' }));
    await user.click(screen.getByRole('button', { name: 'verify-enable' }));

    await waitFor(() => {
      expect(screen.getByText('CODE1111')).toBeInTheDocument();
      expect(screen.getByText('CODE2222')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'copy-code' }));
    fireEvent.click(screen.getByRole('button', { name: 'copy-all' }));

    expect(mockState.copyToClipboard).toHaveBeenCalledWith('CODE1111');
    expect(mockState.copyToClipboard).toHaveBeenCalledWith('CODE1111\nCODE2222');
    expect(screen.getByTestId('setup-copied-code')).toHaveTextContent('');
  });

  it('covers modal close handlers and password visibility toggle callbacks', async () => {
    const user = userEvent.setup();
    render(<Account />);

    await user.click(screen.getByRole('button', { name: 'toggle-current-password' }));
    await user.click(screen.getByRole('button', { name: 'toggle-new-password' }));
    await user.click(screen.getByRole('button', { name: 'toggle-confirm-password' }));

    await user.click(screen.getByRole('button', { name: 'start-setup' }));
    expect(await screen.findByTestId('setup-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'close-setup' }));
    expect(screen.queryByTestId('setup-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'open-disable' }));
    expect(await screen.findByTestId('disable-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'close-disable' }));
    expect(screen.queryByTestId('disable-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'open-backup' }));
    expect(await screen.findByTestId('backup-codes-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'close-backup' }));
    expect(screen.queryByTestId('backup-codes-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'open-backup' }));
    expect(await screen.findByTestId('backup-codes-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'done-backup' }));
    expect(screen.queryByTestId('backup-codes-modal')).not.toBeInTheDocument();
  });

  it('clears copied-code state after clipboard success timeouts', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const user = userEvent.setup();
    render(<Account />);

    await user.click(screen.getByRole('button', { name: 'start-setup' }));
    await user.click(screen.getByRole('button', { name: 'set-valid-code' }));
    await user.click(screen.getByRole('button', { name: 'verify-enable' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText('CODE1111')).toBeInTheDocument();
    expect(screen.getByText('CODE2222')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'copy-code' }));
    expect(screen.getByTestId('setup-copied-code')).toHaveTextContent('code-1');

    await user.click(screen.getByRole('button', { name: 'copy-all' }));
    expect(screen.getByTestId('setup-copied-code')).toHaveTextContent('all');

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 2000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });

    expect(screen.getByTestId('setup-copied-code')).toHaveTextContent('');
    timeoutSpy.mockRestore();
  });
});
