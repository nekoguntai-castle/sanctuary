import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DisplayTab } from '../../../../components/Settings/sections/DisplaySection';

const {
  state,
  mockToggleShowFiat,
  mockSetFiatCurrency,
  mockSetUnit,
} = vi.hoisted(() => ({
  state: {
    showFiat: true,
    fiatCurrency: 'USD',
    unit: 'sats',
  },
  mockToggleShowFiat: vi.fn(),
  mockSetFiatCurrency: vi.fn(),
  mockSetUnit: vi.fn(),
}));

vi.mock('../../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    showFiat: state.showFiat,
    fiatCurrency: state.fiatCurrency,
    unit: state.unit,
    toggleShowFiat: mockToggleShowFiat,
    setFiatCurrency: mockSetFiatCurrency,
    setUnit: mockSetUnit,
  }),
}));

describe('DisplaySection branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.showFiat = true;
    state.fiatCurrency = 'USD';
    state.unit = 'sats';
  });

  it('handles unit switch, fiat toggle, and fiat-currency select actions', () => {
    const { container } = render(<DisplayTab />);

    fireEvent.click(screen.getByText('BTC'));
    expect(mockSetUnit).toHaveBeenCalledWith('btc');

    const toggle = container.querySelector('button.h-8.w-14') as HTMLButtonElement;
    expect(toggle.className).toContain('bg-primary-600');
    fireEvent.click(toggle);
    expect(mockToggleShowFiat).toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EUR' } });
    expect(mockSetFiatCurrency).toHaveBeenCalledWith('EUR');
  });

  it('renders alternate class branches when unit is btc and fiat display is off', () => {
    state.showFiat = false;
    state.unit = 'btc';
    state.fiatCurrency = 'JPY';

    const { container } = render(<DisplayTab />);
    const toggle = container.querySelector('button.h-8.w-14') as HTMLButtonElement;

    expect(toggle.className).toContain('bg-sanctuary-300');
    expect(screen.getByText('Display JPY value alongside Bitcoin amounts.')).toBeInTheDocument();
  });
});
