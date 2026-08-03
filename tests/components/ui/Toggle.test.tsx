import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from '../../../src/components/ui/Toggle';

describe('Toggle', () => {
  it('uses custom classes and reports the next checked state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Toggle
        checked={false}
        onChange={onChange}
        ariaLabel="Enable testnet sync"
        className="data-test-toggle"
        activeClassName="bg-testnet-500"
        inactiveClassName="bg-testnet-100"
        thumbClassName="bg-testnet-950"
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'Enable testnet sync' });
    expect(toggle).toHaveClass('data-test-toggle');
    expect(toggle).toHaveClass('bg-testnet-100');
    expect(toggle.querySelector('span')).toHaveClass('bg-testnet-950');

    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('uses default thumb styling and honors disabled checked state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Toggle
        checked
        disabled
        color="success"
        onChange={onChange}
        ariaLabel="Enable success mode"
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'Enable success mode' });
    expect(toggle).toHaveClass('bg-success-500');
    expect(toggle).toHaveClass('opacity-50');
    expect(toggle).toBeDisabled();
    expect(toggle.querySelector('span')).toHaveClass('bg-white');
    expect(toggle.querySelector('span')).toHaveClass('translate-x-6');

    await user.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });
});
