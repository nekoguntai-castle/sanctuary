import { fireEvent,render,screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe,expect,it,vi } from 'vitest';
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

  it('collapses to an icon-only rail at md while staying accessible (#51)', () => {
    render(
      <MemoryRouter initialEntries={['/wallets']}>
        <NavItem to="/wallets" icon={Icon as any} label="Wallets" hasSubmenu isOpen={false} onToggle={vi.fn()} />
      </MemoryRouter>
    );

    // The link keeps an accessible name + tooltip when the text label is hidden.
    const link = screen.getByRole('link', { name: 'Wallets' });
    expect(link).toHaveAttribute('aria-label', 'Wallets');
    expect(link).toHaveAttribute('title', 'Wallets');

    // Label collapses md→lg only — never a bare `hidden`, which would also blank
    // it in the mobile overlay (rendered below md from the same element tree).
    const label = screen.getByText('Wallets');
    expect(label).toHaveClass('md:hidden', 'lg:inline');
    expect(label).not.toHaveClass('hidden');

    // Icon margin and the submenu chevron collapse with the rail.
    expect(screen.getByTestId('nav-icon')).toHaveClass('md:mr-0', 'lg:mr-3');
    expect(screen.getByRole('button')).toHaveClass('md:hidden', 'lg:block');
  });
});
