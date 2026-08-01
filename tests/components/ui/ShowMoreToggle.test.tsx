import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShowMoreToggle } from '../../../components/ui/ShowMoreToggle';

describe('ShowMoreToggle', () => {
  it('renders the collapsed label with a down chevron and fires onToggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    const { container } = render(
      <ShowMoreToggle expanded={false} onToggle={onToggle} collapsedLabel="Show all 9 wallets" />
    );

    const button = screen.getByRole('button', { name: /Show all 9 wallets/ });
    expect(button).toHaveAttribute('type', 'button');
    expect(container.querySelector('.lucide-chevron-down')).toBeInTheDocument();

    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders the default expanded label with an up chevron', () => {
    const { container } = render(
      <ShowMoreToggle expanded onToggle={vi.fn()} collapsedLabel="Show all" />
    );

    expect(screen.getByRole('button', { name: /Show less/ })).toBeInTheDocument();
    expect(container.querySelector('.lucide-chevron-up')).toBeInTheDocument();
  });

  it('honours a custom expanded label', () => {
    render(
      <ShowMoreToggle
        expanded
        onToggle={vi.fn()}
        collapsedLabel="Show 4 More"
        expandedLabel="Show Less"
      />
    );

    expect(screen.getByRole('button', { name: /Show Less/ })).toBeInTheDocument();
  });

  it('omits disclosure ARIA when no region id is supplied', () => {
    render(<ShowMoreToggle expanded={false} onToggle={vi.fn()} collapsedLabel="Show all" />);

    const button = screen.getByRole('button');
    expect(button).not.toHaveAttribute('aria-expanded');
    expect(button).not.toHaveAttribute('aria-controls');
  });

  it('sets disclosure ARIA when a controlled region id is supplied', () => {
    render(
      <ShowMoreToggle
        expanded
        onToggle={vi.fn()}
        collapsedLabel="Show all"
        controls="region-1"
        className="mt-3 w-full"
      />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'region-1');
    expect(button.className).toContain('mt-3');
    expect(button.className).toContain('w-full');
  });
});
