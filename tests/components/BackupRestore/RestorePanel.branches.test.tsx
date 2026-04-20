import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RestorePanel } from '../../../components/BackupRestore/RestorePanel';
import type { SanctuaryBackup } from '../../../src/api/admin';

vi.mock('../../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

describe('RestorePanel branch coverage', () => {
  it('handles an uploaded backup before metadata or validation result is available', () => {
    const uploadedBackup = { data: {} } as SanctuaryBackup;

    render(
      <RestorePanel
        uploadedBackup={uploadedBackup}
        uploadedFileName="minimal-backup.json"
        validationResult={null}
        isValidating={false}
        isRestoring={false}
        restoreError={null}
        restoreSuccess={false}
        showConfirmModal={false}
        confirmText=""
        fileInputRef={React.createRef<HTMLInputElement>()}
        setShowConfirmModal={vi.fn()}
        setConfirmText={vi.fn()}
        handleFileUpload={vi.fn()}
        handleClearUpload={vi.fn()}
        handleRestore={vi.fn()}
        formatDate={(date) => date}
      />
    );

    expect(screen.getByText('minimal-backup.json')).toBeInTheDocument();
    expect(screen.queryByText(/Backup is valid and ready to restore/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore from backup/i })).toBeDisabled();
  });
});
