import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportReview } from '../../../../components/DeviceDetail/accounts/ImportReview';

describe('DeviceDetail ImportReview branch coverage', () => {
  const parsedAccounts = [
    { purpose: 'single_sig', derivationPath: "m/84'/0'/0'" },
  ] as any;

  it('does not render existing-account notice when conflict has zero matching accounts', () => {
    render(
      <ImportReview
        parsedAccounts={parsedAccounts}
        selectedParsedAccounts={new Set([0])}
        setSelectedParsedAccounts={vi.fn()}
        accountConflict={{
          existingAccounts: [],
          newAccounts: parsedAccounts,
          matchingAccounts: [],
        }}
        addAccountLoading={false}
        onAddParsedAccounts={vi.fn()}
      />
    );

    expect(screen.queryByText(/account\(s\) already exist/i)).not.toBeInTheDocument();
  });

  it('does not render existing-account notice when conflict is null', () => {
    render(
      <ImportReview
        parsedAccounts={parsedAccounts}
        selectedParsedAccounts={new Set([0])}
        setSelectedParsedAccounts={vi.fn()}
        accountConflict={null}
        addAccountLoading={false}
        onAddParsedAccounts={vi.fn()}
      />
    );

    expect(screen.queryByText(/account\(s\) already exist/i)).not.toBeInTheDocument();
  });

  it('renders existing-account notice when matching accounts are present', () => {
    render(
      <ImportReview
        parsedAccounts={parsedAccounts}
        selectedParsedAccounts={new Set([0])}
        setSelectedParsedAccounts={vi.fn()}
        accountConflict={{
          existingAccounts: [{ id: 'acc-1' } as any],
          newAccounts: [],
          matchingAccounts: [{ purpose: 'single_sig', derivationPath: "m/84'/0'/0'" } as any],
        }}
        addAccountLoading={false}
        onAddParsedAccounts={vi.fn()}
      />
    );

    expect(screen.getByText(/1 account\(s\) already exist/i)).toBeInTheDocument();
  });
});
