import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictDialog } from '../../../components/ConnectDevice/ConflictDialog';

function createConflictData(overrides: Record<string, unknown> = {}) {
  return {
    existingDevice: {
      id: 'device-1',
      type: 'ledger',
      label: 'My Ledger',
      fingerprint: 'f00dbabe',
      accounts: [{}, {}],
    },
    comparison: {
      newAccounts: [{ derivationPath: "m/84'/0'/0'" }, { derivationPath: "m/84'/0'/1'" }],
      matchingAccounts: [{ derivationPath: "m/84'/0'/2'" }],
      conflictingAccounts: [],
    },
    ...overrides,
  } as any;
}

describe('ConflictDialog', () => {
  it('renders summary and calls merge/view/cancel handlers', async () => {
    const user = userEvent.setup();
    const onMerge = vi.fn();
    const onViewExisting = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConflictDialog
        conflictData={createConflictData()}
        merging={false}
        error={null}
        onMerge={onMerge}
        onViewExisting={onViewExisting}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(/Device Already Exists/i)).toBeInTheDocument();
    expect(screen.getByText(/2 New Accounts Can Be Added/i)).toBeInTheDocument();
    expect(screen.getByText(/1 Account Already Exist/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Merge 2 New Accounts/i }));
    await user.click(screen.getByRole('button', { name: /View Existing Device/i }));
    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onMerge).toHaveBeenCalledTimes(1);
    expect(onViewExisting).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables merge and shows conflict warning when conflicting accounts exist', () => {
    render(
      <ConflictDialog
        conflictData={createConflictData({
          comparison: {
            newAccounts: [{ derivationPath: "m/84'/0'/0'" }],
            matchingAccounts: [],
            conflictingAccounts: [{ incoming: { derivationPath: "m/84'/0'/0'" } }],
          },
        })}
        merging={false}
        error={null}
        onMerge={vi.fn()}
        onViewExisting={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Merge 1 New Account/i })).toBeDisabled();
    expect(
      screen.getByText(/Cannot merge while there are conflicting accounts/i)
    ).toBeInTheDocument();
  });

  it('shows merging and explicit error states', () => {
    render(
      <ConflictDialog
        conflictData={createConflictData({
          comparison: {
            newAccounts: [{ derivationPath: "m/84'/0'/0'" }],
            matchingAccounts: [],
            conflictingAccounts: [],
          },
        })}
        merging
        error="Merge failed"
        onMerge={vi.fn()}
        onViewExisting={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Merging/i })).toBeDisabled();
    expect(screen.getByText('Merge failed')).toBeInTheDocument();
  });

  it('renders singular/plural copy branches for existing, matching, and conflicting account counts', () => {
    render(
      <ConflictDialog
        conflictData={createConflictData({
          existingDevice: {
            id: 'device-1',
            type: 'ledger',
            label: 'My Ledger',
            fingerprint: 'f00dbabe',
            accounts: [{}],
          },
          comparison: {
            newAccounts: [],
            matchingAccounts: [
              { derivationPath: "m/84'/0'/2'" },
              { derivationPath: "m/84'/0'/3'" },
            ],
            conflictingAccounts: [
              { incoming: { derivationPath: "m/84'/0'/4'" } },
              { incoming: { derivationPath: "m/84'/0'/5'" } },
            ],
          },
        })}
        merging={false}
        error={null}
        onMerge={vi.fn()}
        onViewExisting={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('1 account registered')).toBeInTheDocument();
    expect(screen.getByText(/2 Accounts Already Exist/i)).toBeInTheDocument();
    expect(screen.getByText(/2 Conflicting Accounts/i)).toBeInTheDocument();
  });
});
