import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavItem } from '../../../components/Layout/NavItem';

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
}));

describe('NavItem branch coverage', () => {
  const Icon = ({ className }: { className?: string }) => <span data-testid="nav-icon" className={className} />;

  it('calls onToggle when submenu button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={['/wallets']}>
        <NavItem to="/wallets" icon={Icon as any} label="Wallets" hasSubmenu isOpen={false} onToggle={onToggle} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('handles submenu click when onToggle is not provided', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavItem to="/" icon={Icon as any} label="Home" hasSubmenu isOpen={true} />
      </MemoryRouter>
    );

    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow();
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
  });
});
