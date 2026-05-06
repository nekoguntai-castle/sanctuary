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

  it('uses a two-column network grid so all four labels fit in the sidebar', () => {
    render(
      <SidebarNetworkSelector
        selectedNetwork="testnet4"
        onNetworkChange={vi.fn()}
        networkAvailability={availability}
      />
    );

    const nav = screen.getByRole('navigation', { name: 'Network tabs' });
    const selectedButton = screen.getByRole('button', { name: 'Testnet4' });

    expect(nav).toHaveClass('grid', 'grid-cols-2', 'w-full');
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByTestId('network-tabs-indicator')).not.toBeInTheDocument();
    expect(selectedButton).toHaveClass('bg-white', 'shadow-sm', 'text-sanctuary-900');
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
