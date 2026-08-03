import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UtxoGardenDot } from '../../../../src/components/UTXOList/UTXOGarden/UtxoGardenDot';
import type { UtxoGardenDotModel } from '../../../../src/components/UTXOList/UTXOGarden/types';

const makeModel = (overrides: Partial<UtxoGardenDotModel> = {}): UtxoGardenDotModel => ({
  id: 'utxo-1',
  size: 24,
  style: { background: 'red' },
  colorClass: 'bg-primary-500',
  isDisabled: false,
  isSelected: false,
  title: '50,000 sats',
  formattedAmount: '50,000 sats',
  ...overrides,
});

describe('UtxoGardenDot', () => {
  it('reveals the amount on touch and selects on click for an enabled dot', () => {
    const onToggleSelect = vi.fn();
    const model = makeModel();
    render(<UtxoGardenDot model={model} onToggleSelect={onToggleSelect} />);

    // hover:none keeps the amount visible on touch devices (where :hover never
    // fires and the native title= tooltip does not surface).
    const amount = screen.getByText('50,000 sats');
    expect(amount).toHaveClass('[@media(hover:none)]:opacity-100');
    expect(amount).toHaveClass('hover:opacity-100');

    fireEvent.click(screen.getByTitle('50,000 sats'));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith('utxo-1');
  });

  it('does not select a disabled dot and marks it not-allowed', () => {
    const onToggleSelect = vi.fn();
    const model = makeModel({ isDisabled: true });
    render(<UtxoGardenDot model={model} onToggleSelect={onToggleSelect} />);

    const dot = screen.getByTitle('50,000 sats');
    expect(dot).toHaveClass('cursor-not-allowed');

    fireEvent.click(dot);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('is inert when no onToggleSelect handler is provided', () => {
    const model = makeModel();
    render(<UtxoGardenDot model={model} />);

    // Should not throw when clicked without a handler.
    fireEvent.click(screen.getByTitle('50,000 sats'));
    expect(screen.getByText('50,000 sats')).toBeInTheDocument();
  });

  it('shows the selected ring when the dot is selected', () => {
    const model = makeModel({ isSelected: true });
    render(<UtxoGardenDot model={model} onToggleSelect={vi.fn()} />);

    const dot = screen.getByTitle('50,000 sats');
    expect(dot).toHaveClass('ring-2');
    expect(dot).toHaveClass('ring-sanctuary-400');
  });
});
