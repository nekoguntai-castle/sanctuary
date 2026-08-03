import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { BackupCompleteModal } from '../../../src/components/BackupRestore/BackupCompleteModal';

const encryptionKeys = {
  encryptionKey: 'enc-key-123',
  encryptionSalt: 'enc-salt-456',
  hasEncryptionKey: true,
  hasEncryptionSalt: true,
};

describe('BackupCompleteModal branch coverage', () => {
  it('renders copy button default state and triggers actions', () => {
    const setDontShowAgain = vi.fn();
    const copyToClipboard = vi.fn();
    const downloadEncryptionKeys = vi.fn();
    const onDismiss = vi.fn();

    render(
      <BackupCompleteModal
        encryptionKeys={encryptionKeys}
        copiedKey={null}
        dontShowAgain={false}
        setDontShowAgain={setDontShowAgain}
        copyToClipboard={copyToClipboard}
        downloadEncryptionKeys={downloadEncryptionKeys}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText('Copy Both')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Copy Both'));
    expect(copyToClipboard).toHaveBeenCalledWith(
      'ENCRYPTION_KEY=enc-key-123\nENCRYPTION_SALT=enc-salt-456',
      'modal-both'
    );

    fireEvent.click(screen.getByText('Download .txt'));
    expect(downloadEncryptionKeys).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(setDontShowAgain).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByText("I've Saved My Keys"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders copied state when copiedKey is modal-both', () => {
    render(
      <BackupCompleteModal
        encryptionKeys={encryptionKeys}
        copiedKey="modal-both"
        dontShowAgain={true}
        setDontShowAgain={vi.fn()}
        copyToClipboard={vi.fn()}
        downloadEncryptionKeys={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText('Copied!')).toBeInTheDocument();
    expect(screen.queryByText('Copy Both')).not.toBeInTheDocument();
  });
});
