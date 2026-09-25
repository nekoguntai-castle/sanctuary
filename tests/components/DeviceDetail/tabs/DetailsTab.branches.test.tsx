import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DetailsTab } from '../../../../src/components/DeviceDetail/tabs/DetailsTab';

vi.mock('../../../../src/components/ui/CustomIcons', () => ({
  getWalletIcon: (type: string, className: string) => <span className={className}>icon-{type}</span>,
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('DetailsTab branch coverage', () => {
  it('renders empty-state copy when no wallets are associated', () => {
    render(<MemoryRouter><DetailsTab wallets={[]} /></MemoryRouter>);
    expect(screen.getByText('No wallets are currently using this device.')).toBeInTheDocument();
  });

  it('renders badges and native wallet links that preserve the default destination tab', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/devices/device-1?tab=details']}>
        <DetailsTab
          wallets={[
            { id: 'wallet-1', name: 'Singles', type: 'single_sig' },
            { id: 'wallet-2', name: 'Multisig', type: 'multi_sig' },
          ]}
        />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(screen.getByText('Single Sig')).toBeInTheDocument();
    expect(screen.getAllByText('Multisig').length).toBeGreaterThan(0);
    const single = screen.getByRole('link', { name: /Singles/ });
    const multisig = screen.getByRole('link', { name: /ID: wallet-2/ });
    expect(single).toHaveAttribute('href', '/wallets/wallet-1');
    expect(multisig).toHaveAttribute('href', '/wallets/wallet-2');
    await user.tab();
    expect(single).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/wallets\/wallet-1$/);
    await user.tab();
    expect(multisig).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/wallets\/wallet-2$/);
  });
});
