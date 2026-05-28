import { render, screen, fireEvent } from '@testing-library/react';
import type React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, WalletEmptyState, DeviceEmptyState } from '../../../components/ui/EmptyState';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No items" description="Nothing to show" />);
    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">icon</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders non-element icon without cloning', () => {
    render(<EmptyState title="Empty" icon={'text-icon' as unknown as React.ReactNode} />);
    expect(screen.getByText('text-icon')).toBeInTheDocument();
  });

  it('renders route actions as links when actionTo is set', () => {
    renderWithRouter(<EmptyState title="Empty" actionLabel="Go" actionTo="/somewhere" />);
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/somewhere');
  });

  it('calls onAction callback when clicked', () => {
    const onAction = vi.fn();
    render(<EmptyState title="Empty" actionLabel="Do it" onAction={onAction} />);
    fireEvent.click(screen.getByText('Do it'));
    expect(onAction).toHaveBeenCalled();
  });

  it('renders compact variant', () => {
    renderWithRouter(<EmptyState title="Compact" compact actionLabel="Act" actionTo="/x" />);
    expect(screen.getByText('Compact')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Act' })).toHaveAttribute('href', '/x');
  });

  it('renders compact with onAction', () => {
    const onAction = vi.fn();
    render(<EmptyState title="Compact" compact actionLabel="Act" onAction={onAction} />);
    fireEvent.click(screen.getByText('Act'));
    expect(onAction).toHaveBeenCalled();
  });

  it('omits compact action when no action label is provided', () => {
    render(<EmptyState title="Compact" compact />);
    expect(screen.getByText('Compact')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('handles action click with no actionTo or onAction', () => {
    render(<EmptyState title="Empty" actionLabel="Click me" />);
    fireEvent.click(screen.getByText('Click me'));
    // No error thrown, action is a no-op
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });
});

describe('WalletEmptyState', () => {
  it('renders with default network', () => {
    renderWithRouter(<WalletEmptyState />);
    expect(screen.getByText('No mainnet wallets yet')).toBeInTheDocument();
  });

  it('renders with custom network', () => {
    renderWithRouter(<WalletEmptyState network="testnet" />);
    expect(screen.getByText('No testnet wallets yet')).toBeInTheDocument();
  });
});

describe('DeviceEmptyState', () => {
  it('renders device empty state', () => {
    renderWithRouter(<DeviceEmptyState />);
    expect(screen.getByText('No devices connected')).toBeInTheDocument();
    expect(screen.getByText('Connect Device')).toBeInTheDocument();
  });
});
