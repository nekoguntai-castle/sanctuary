import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EncryptionKeyDisplay } from '../../../components/BackupRestore/EncryptionKeyDisplay';

describe('EncryptionKeyDisplay branch coverage', () => {
  const encryptionKeys = {
    encryptionKey: 'test-encryption-key-12345',
    encryptionSalt: 'test-salt-abcdef',
  };

  it('renders revealed salt state with copied salt indicator', () => {
    render(
      <EncryptionKeyDisplay
        encryptionKeys={encryptionKeys}
        isLoadingKeys={false}
        showEncryptionKey={false}
        setShowEncryptionKey={vi.fn()}
        showEncryptionSalt
        setShowEncryptionSalt={vi.fn()}
        copiedKey="salt"
        copyToClipboard={vi.fn()}
        downloadEncryptionKeys={vi.fn()}
      />
    );

    expect(screen.getByText('test-salt-abcdef')).toBeInTheDocument();
    expect(screen.getByTitle('Hide')).toBeInTheDocument();

    const copyButtons = screen.getAllByTitle('Copy to clipboard');
    expect(copyButtons[1].querySelector('.text-success-500')).toBeTruthy();
  });

  it('handles salt show toggle and salt copy actions', async () => {
    const user = userEvent.setup();
    const setShowEncryptionSalt = vi.fn();
    const copyToClipboard = vi.fn();

    render(
      <EncryptionKeyDisplay
        encryptionKeys={encryptionKeys}
        isLoadingKeys={false}
        showEncryptionKey={false}
        setShowEncryptionKey={vi.fn()}
        showEncryptionSalt={false}
        setShowEncryptionSalt={setShowEncryptionSalt}
        copiedKey={null}
        copyToClipboard={copyToClipboard}
        downloadEncryptionKeys={vi.fn()}
      />
    );

    const showButtons = screen.getAllByTitle('Show');
    await user.click(showButtons[1]);
    expect(setShowEncryptionSalt).toHaveBeenCalledWith(true);

    const copyButtons = screen.getAllByTitle('Copy to clipboard');
    await user.click(copyButtons[1]);
    expect(copyToClipboard).toHaveBeenCalledWith('test-salt-abcdef', 'salt');
  });
});
