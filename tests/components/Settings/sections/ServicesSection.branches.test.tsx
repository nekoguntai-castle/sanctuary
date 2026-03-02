import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesTab } from '../../../../components/Settings/sections/ServicesSection';

const state = vi.hoisted(() => ({
  priceProvider: 'auto',
  btcPrice: null as number | null,
}));

const mockSetPriceProvider = vi.fn();
const mockRefreshPrice = vi.fn();

vi.mock('../../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    priceProvider: state.priceProvider,
    setPriceProvider: mockSetPriceProvider,
    availableProviders: ['auto', 'coingecko'],
    refreshPrice: mockRefreshPrice,
    priceLoading: false,
    lastPriceUpdate: null,
    btcPrice: state.btcPrice,
    currencySymbol: '$',
  }),
}));

describe('ServicesSection branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers provider description and price display branches', () => {
    const { rerender } = render(<ServicesTab />);

    expect(screen.getByText(/aggregated prices from multiple sources/i)).toBeInTheDocument();
    expect(screen.getByText('-----')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'coingecko' } });
    expect(mockSetPriceProvider).toHaveBeenCalledWith('coingecko');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Price' }));
    expect(mockRefreshPrice).toHaveBeenCalledTimes(1);

    state.priceProvider = 'coingecko';
    state.btcPrice = 98765;
    rerender(<ServicesTab />);

    expect(screen.getByText('Using coingecko as the exclusive price source.')).toBeInTheDocument();
    expect(screen.getByText('$98,765')).toBeInTheDocument();
  });
});
