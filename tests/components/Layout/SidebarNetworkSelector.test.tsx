import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNetworkSelector } from '../../../components/Layout/SidebarContent/SidebarNetworkSelector';

describe('SidebarNetworkSelector', () => {
const availability = { mainnet: true, testnet3: true, testnet4: true, signet: true };
const selectorSpacing = () => screen.getByRole('navigation', { name: 'Network tabs' }).parentElement?.parentElement;

  it('shows the section label in expanded sidebar mode', () => {
    render(
      <SidebarNetworkSelector
        selectedNetwork="mainnet"
        onNetworkChange={vi.fn()}
        networkAvailability={availability}
      />
    );

    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(selectorSpacing()).toHaveClass('px-1', 'pb-2');
  });

  it('uses compact spacing without the section label in header mode', () => {
    render(
      <SidebarNetworkSelector
        selectedNetwork="mainnet"
        onNetworkChange={vi.fn()}
        networkAvailability={availability}
        compact
      />
    );

    expect(screen.queryByText('Network')).not.toBeInTheDocument();
    expect(selectorSpacing()).toHaveClass('px-0');
  });
});
