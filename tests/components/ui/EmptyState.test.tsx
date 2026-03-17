import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, WalletEmptyState, DeviceEmptyState } from '../../../components/ui/EmptyState';

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

  it('renders action button and navigates via hash when actionTo is set', () => {
    render(<EmptyState title="Empty" actionLabel="Go" actionTo="/somewhere" />);
    const button = screen.getByText('Go');
    fireEvent.click(button);
    expect(window.location.hash).toBe('#/somewhere');
  });

  it('calls onAction callback when clicked', () => {
    const onAction = vi.fn();
    render(<EmptyState title="Empty" actionLabel="Do it" onAction={onAction} />);
    fireEvent.click(screen.getByText('Do it'));
    expect(onAction).toHaveBeenCalled();
  });

  it('renders compact variant', () => {
    render(<EmptyState title="Compact" compact actionLabel="Act" actionTo="/x" />);
    expect(screen.getByText('Compact')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Act'));
    expect(window.location.hash).toBe('#/x');
  });

  it('renders compact with onAction', () => {
    const onAction = vi.fn();
    render(<EmptyState title="Compact" compact actionLabel="Act" onAction={onAction} />);
    fireEvent.click(screen.getByText('Act'));
    expect(onAction).toHaveBeenCalled();
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
    render(<WalletEmptyState />);
    expect(screen.getByText('No mainnet wallets yet')).toBeInTheDocument();
  });

  it('renders with custom network', () => {
    render(<WalletEmptyState network="testnet" />);
    expect(screen.getByText('No testnet wallets yet')).toBeInTheDocument();
  });
});

describe('DeviceEmptyState', () => {
  it('renders device empty state', () => {
    render(<DeviceEmptyState />);
    expect(screen.getByText('No devices connected')).toBeInTheDocument();
    expect(screen.getByText('Connect Device')).toBeInTheDocument();
  });
});
