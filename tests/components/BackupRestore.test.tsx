/**
 * BackupRestore Component Tests
 *
 * Tests the backup and restore functionality for database management.
 */

import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';

// Mock admin API
const mockCreateBackup = vi.fn();
const mockValidateBackup = vi.fn();
const mockRestoreBackup = vi.fn();
const mockGetEncryptionKeys = vi.fn();

vi.mock('../../src/api/admin', () => ({
  createBackup: (...args: unknown[]) => mockCreateBackup(...args),
  validateBackup: (...args: unknown[]) => mockValidateBackup(...args),
  restoreBackup: (...args: unknown[]) => mockRestoreBackup(...args),
  getEncryptionKeys: (password: string) => mockGetEncryptionKeys(password),
}));

// Mock notification context
const mockAddNotification = vi.fn();
vi.mock('../../contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({
    addNotification: mockAddNotification,
  }),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockDownloadText = vi.fn();
const mockDownloadBlob = vi.fn();
vi.mock('../../utils/download', () => ({
  downloadText: (...args: unknown[]) => mockDownloadText(...args),
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Database: () => <span data-testid="database-icon" />,
  Download: () => <span data-testid="download-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-circle-icon" />,
  FileJson: () => <span data-testid="file-json-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  User: () => <span data-testid="user-icon" />,
  Layers: () => <span data-testid="layers-icon" />,
  X: () => <span data-testid="x-icon" />,
  Key: () => <span data-testid="key-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  Eye: () => <span data-testid="eye-icon" />,
  EyeOff: () => <span data-testid="eye-off-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  FileText: () => <span data-testid="file-text-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

const mockClipboardWriteText = vi.fn();
const installClipboardMock = () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockClipboardWriteText },
    configurable: true,
  });
  mockClipboardWriteText.mockResolvedValue(undefined);
};

const renderBackupRestore = async (BackupRestore: React.ComponentType) => {
  render(<BackupRestore />, { wrapper: createWrapper() });
  // Wait for initial render to settle
  await waitFor(() => {
    expect(screen.getByText(/backup & restore/i)).toBeInTheDocument();
  });
};

/**
 * Helper to reveal encryption keys by entering password in the prompt
 */
const revealEncryptionKeys = async (user: ReturnType<typeof userEvent.setup>) => {
  const passwordInput = screen.getByPlaceholderText(/enter your password/i);
  await user.type(passwordInput, 'test-password');
  await user.click(screen.getByRole('button', { name: /reveal/i }));
  await waitFor(() => {
    expect(mockGetEncryptionKeys).toHaveBeenCalledWith('test-password');
  });
};

describe('BackupRestore Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset localStorage
    localStorage.clear();
    // Setup default mock responses
    mockGetEncryptionKeys.mockResolvedValue({
      encryptionKey: 'test-encryption-key-12345',
      encryptionSalt: 'test-salt-abcdef',
    });
    installClipboardMock();
  });

  it('should render backup tab by default', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    await renderBackupRestore(BackupRestore);

    expect(screen.getByText(/backup & restore/i)).toBeInTheDocument();
    expect(screen.getByText(/create backup/i)).toBeInTheDocument();
    expect(screen.getByText(/download backup/i)).toBeInTheDocument();
  });

  it('should switch to restore tab when clicked', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    // Should show restore content - look for the heading specifically
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /restore from backup/i })).toBeInTheDocument();
    });

    const backupTab = screen.getByRole('button', { name: /^backup$/i });
    await user.click(backupTab);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create backup/i })).toBeInTheDocument();
    });
  });

  it('should show encryption keys section', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    await renderBackupRestore(BackupRestore);

    // Encryption keys section is always visible
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /encryption keys/i })).toBeInTheDocument();
    });
  });

  it('should show password prompt for encryption keys', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    await renderBackupRestore(BackupRestore);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument();
    });
  });

  it('should toggle include cache checkbox', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);

    // Find the toggle button (it's the button element within the toggle container)
    const toggleLabel = screen.getByText(/include cache data/i);
    const toggleContainer = toggleLabel.closest('div')?.parentElement;
    const toggleButton = toggleContainer?.querySelector('button');
    expect(toggleButton).toBeInTheDocument();

    // Initially should not be enabled
    expect(toggleButton).not.toHaveClass('bg-primary-600');

    await user.click(toggleButton!);

    // The toggle should have changed state (has specific class when enabled)
    await waitFor(() => {
      expect(toggleButton).toHaveClass('bg-primary-600');
    });
  });

  it('should allow entering backup description', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);

    const descriptionInput = screen.getByPlaceholderText(/before migration/i);
    await user.type(descriptionInput, 'Test backup');

    expect(descriptionInput).toHaveValue('Test backup');
  });

  it('should create backup when download button is clicked', async () => {
    const mockBlob = new Blob(['{}'], { type: 'application/json' });
    mockCreateBackup.mockResolvedValue(mockBlob);

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    // Mock URL.createObjectURL and revokeObjectURL
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test');
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    await renderBackupRestore(BackupRestore);

    const downloadButton = screen.getByText(/download backup/i);
    await user.click(downloadButton);

    await waitFor(() => {
      expect(mockCreateBackup).toHaveBeenCalledWith({
        includeCache: false,
        description: undefined,
      });
    });
  });

  it('should show warning in restore tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    await waitFor(() => {
      expect(screen.getByText(/delete all existing data/i)).toBeInTheDocument();
    });
  });

  it('should show file upload area in restore tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    await waitFor(() => {
      expect(screen.getByText(/drop backup file here/i)).toBeInTheDocument();
    });
  });

  it('should show about backups info when on backup tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');

    await renderBackupRestore(BackupRestore);

    expect(screen.getByText(/about backups/i)).toBeInTheDocument();
    expect(screen.getByText(/backups include all users/i)).toBeInTheDocument();
  });

  it('should show about restore info when on restore tab', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);

    // Click the Restore tab
    const restoreTab = screen.getByRole('button', { name: /restore/i });
    await user.click(restoreTab);

    await waitFor(() => {
      expect(screen.getByText(/about restore/i)).toBeInTheDocument();
      expect(screen.getByText(/restoring will completely replace/i)).toBeInTheDocument();
    });
  });
});

describe('BackupRestore Component - Encryption Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetEncryptionKeys.mockResolvedValue({
      encryptionKey: 'test-encryption-key-12345',
      encryptionSalt: 'test-salt-abcdef',
    });
    installClipboardMock();
  });

  it('should display masked encryption keys after password confirmation', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);
    await revealEncryptionKeys(user);

    await waitFor(() => {
      expect(screen.getByText(/encryption_key/i)).toBeInTheDocument();
      expect(screen.getByText(/encryption_salt/i)).toBeInTheDocument();
    });

    // Keys should be masked with bullets
    expect(screen.getAllByText(/•+/).length).toBeGreaterThan(0);
  });

  it('should handle encryption key loading error gracefully', async () => {
    mockGetEncryptionKeys.mockRejectedValue(new Error('Incorrect password'));

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);
    await revealEncryptionKeys(user);

    await waitFor(() => {
      expect(screen.getByText(/incorrect password/i)).toBeInTheDocument();
    });
  });

  it('should show fallback message when non-Error is thrown during key reveal', async () => {
    mockGetEncryptionKeys.mockRejectedValue('unexpected-string-error');

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();

    await renderBackupRestore(BackupRestore);
    await revealEncryptionKeys(user);

    await waitFor(() => {
      expect(screen.getByText(/incorrect password or failed to fetch keys/i)).toBeInTheDocument();
    });
  });
});

describe('BackupRestore Component - Advanced Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetEncryptionKeys.mockResolvedValue({
      encryptionKey: 'test-encryption-key-12345',
      encryptionSalt: 'test-salt-abcdef',
    });
    installClipboardMock();
  });

  it('copies and reveals encryption keys and downloads key file', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);
    await revealEncryptionKeys(user);

    const showButtons = screen.getAllByTitle('Show');
    await user.click(showButtons[0]);
    expect(screen.getByText('test-encryption-key-12345')).toBeInTheDocument();

    await user.click(screen.getAllByTitle('Copy to clipboard')[0]);

    await user.click(screen.getByRole('button', { name: /copy both/i }));

    await user.click(screen.getByRole('button', { name: /download .txt/i }));
    expect(mockDownloadText).toHaveBeenCalled();
    expect(mockDownloadText.mock.calls[0][1]).toMatch(/sanctuary-encryption-keys-/);
  });

  it('shows backup error when create backup API fails', async () => {
    mockCreateBackup.mockRejectedValueOnce(new Error('Backup failed on server'));
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);

    await user.click(screen.getByRole('button', { name: /download backup/i }));
    expect(await screen.findByText('Backup failed on server')).toBeInTheDocument();
  });

  it('shows post-backup key reminder modal and persists dismissal', async () => {
    mockCreateBackup.mockResolvedValueOnce(new Blob(['{}'], { type: 'application/json' }));
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);
    // Reveal encryption keys first so the modal can display
    await revealEncryptionKeys(user);

    await user.click(screen.getByRole('button', { name: /download backup/i }));

    expect(await screen.findByRole('heading', { name: /backup downloaded successfully/i })).toBeInTheDocument();
    const dontShowAgainCheckbox = screen.getByRole('checkbox', { name: /don't show this reminder again/i });
    await user.click(dontShowAgainCheckbox);
    expect(dontShowAgainCheckbox).toBeChecked();
    await user.click(screen.getByRole('button', { name: /i've saved my keys/i }));

    expect(screen.queryByRole('heading', { name: /backup downloaded successfully/i })).not.toBeInTheDocument();
  });

  it('handles invalid JSON backup upload format', async () => {
    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);

    await user.click(screen.getByRole('button', { name: /restore/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['not-json'], 'broken.json', { type: 'application/json' }));

    expect(await screen.findByText(/invalid backup file format/i)).toBeInTheDocument();
  });

  it('shows validation issues and warnings for uploaded backup', async () => {
    mockValidateBackup.mockResolvedValueOnce({
      valid: false,
      issues: ['Missing wallets table'],
      warnings: ['Version mismatch'],
      info: { totalRecords: 10, tables: ['users', 'wallets'] },
    });

    const backup = {
      meta: {
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: 'admin',
        appVersion: '1.0.0',
      },
      data: {},
    };

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);

    await user.click(screen.getByRole('button', { name: /restore/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(backup)) });
    await user.upload(fileInput, file);

    expect(await screen.findByText(/backup validation failed/i)).toBeInTheDocument();
    expect(screen.getByText('Missing wallets table')).toBeInTheDocument();
    expect(screen.getByText('Version mismatch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore from backup/i })).toBeDisabled();
  });

  it('shows uploaded backup description when metadata includes one', async () => {
    mockValidateBackup.mockResolvedValueOnce({
      valid: true,
      issues: [],
      warnings: [],
      info: { totalRecords: 10, tables: ['users', 'wallets'] },
    });

    const backup = {
      meta: {
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: 'admin',
        appVersion: '1.0.0',
        description: 'Nightly snapshot before migration',
      },
      data: {},
    };

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    const toLocaleStringSpy = vi
      .spyOn(Date.prototype, 'toLocaleString')
      .mockImplementationOnce(() => {
        throw new Error('date format failed');
      });

    try {
      await renderBackupRestore(BackupRestore);

      await user.click(screen.getByRole('button', { name: /restore/i }));
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File([''], 'backup.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(backup)) });
      await user.upload(fileInput, file);

      expect(await screen.findByText('"Nightly snapshot before migration"')).toBeInTheDocument();
      expect(screen.getByText('2026-01-01T00:00:00Z')).toBeInTheDocument();
    } finally {
      toLocaleStringSpy.mockRestore();
    }
  });

  it('shows validating state while uploaded backup is being validated', async () => {
    mockValidateBackup.mockImplementationOnce(
      () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve({
                valid: true,
                issues: [],
                warnings: [],
                info: { totalRecords: 10, tables: ['users', 'wallets'] },
              }),
            100
          )
        ) as any
    );

    const backup = {
      meta: {
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: 'admin',
        appVersion: '1.0.0',
      },
      data: {},
    };

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);

    await user.click(screen.getByRole('button', { name: /restore/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(backup)) });
    await user.upload(fileInput, file);

    expect(await screen.findByText(/validating backup/i)).toBeInTheDocument();
  });

  it('runs restore flow after confirmation and emits warning notifications', async () => {
    mockValidateBackup.mockResolvedValueOnce({
      valid: true,
      issues: [],
      warnings: [],
      info: { totalRecords: 5, tables: ['users'] },
    });
    mockRestoreBackup.mockResolvedValueOnce({
      success: true,
      warnings: ['Node password could not be restored'],
    });

    const backup = {
      meta: {
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: 'admin',
        appVersion: '1.0.0',
      },
      data: {},
    };

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);

    await user.click(screen.getByRole('button', { name: /restore/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(backup)) });
    await user.upload(fileInput, file);
    await screen.findByText(/backup is valid and ready to restore/i);

    await user.click(screen.getByRole('button', { name: /^restore from backup$/i }));
    await user.type(screen.getByPlaceholderText(/type restore/i), 'restore');
    await user.click(screen.getByRole('button', { name: /confirm restore/i }));

    await waitFor(() => {
      expect(mockRestoreBackup).toHaveBeenCalled();
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Restore Warning',
      })
    );
    expect(screen.getByText(/database restored successfully/i)).toBeInTheDocument();
  });

  it('closes restore confirmation modal on cancel and resets confirm text', async () => {
    mockValidateBackup.mockResolvedValueOnce({
      valid: true,
      issues: [],
      warnings: [],
      info: { totalRecords: 5, tables: ['users'] },
    });

    const backup = {
      meta: {
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: 'admin',
        appVersion: '1.0.0',
      },
      data: {},
    };

    const { BackupRestore } = await import('../../components/BackupRestore');
    const user = userEvent.setup();
    await renderBackupRestore(BackupRestore);

    await user.click(screen.getByRole('button', { name: /restore/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(backup)) });
    await user.upload(fileInput, file);
    await screen.findByText(/backup is valid and ready to restore/i);

    await user.click(screen.getByRole('button', { name: /^restore from backup$/i }));
    const confirmInput = screen.getByPlaceholderText(/type restore/i);
    await user.type(confirmInput, 'RESTORE');

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('heading', { name: /confirm database restore/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^restore from backup$/i }));
    expect(screen.getByPlaceholderText(/type restore/i)).toHaveValue('');
  });
});
