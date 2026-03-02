import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DetailsTab } from '../../../../components/DeviceDetail/tabs/DetailsTab';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../../components/ui/CustomIcons', () => ({
  getWalletIcon: (type: string, className: string) => <span className={className}>icon-{type}</span>,
}));

describe('DetailsTab branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty-state copy when no wallets are associated', () => {
    render(<DetailsTab wallets={[]} />);
    expect(screen.getByText('No wallets are currently using this device.')).toBeInTheDocument();
  });

  it('renders single-sig and multisig badges and navigates on wallet click', () => {
    render(
      <DetailsTab
        wallets={[
          { id: 'wallet-1', name: 'Singles', type: 'single_sig' },
          { id: 'wallet-2', name: 'Multisig', type: 'multi_sig' },
        ] as any}
      />
    );

    expect(screen.getByText('Single Sig')).toBeInTheDocument();
    expect(screen.getAllByText('Multisig').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('ID: wallet-1'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1');

    fireEvent.click(screen.getByText('ID: wallet-2'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-2');
  });
});
