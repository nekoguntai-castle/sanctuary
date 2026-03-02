import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TabBar } from '../../../components/WalletDetail/TabBar';

describe('TabBar', () => {
  it('renders viewer tabs without drafts/access and maps tx/utxo labels', () => {
    const onTabChange = vi.fn();
    render(
      <TabBar
        activeTab="tx"
        onTabChange={onTabChange}
        userRole="viewer"
        draftsCount={3}
      />
    );

    expect(screen.getByRole('button', { name: 'Transactions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'UTXOs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /drafts/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /access/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'UTXOs' }));
    expect(onTabChange).toHaveBeenCalledWith('utxo');
  });

  it('renders owner-only tabs and hides draft badge at zero', () => {
    render(
      <TabBar
        activeTab="drafts"
        onTabChange={vi.fn()}
        userRole="owner"
        draftsCount={0}
      />
    );

    expect(screen.getByRole('button', { name: /drafts/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /access/i })).toBeInTheDocument();
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
  });

  it('shows exact draft count up to nine and caps at 9+ above that', () => {
    const { rerender } = render(
      <TabBar
        activeTab="drafts"
        onTabChange={vi.fn()}
        userRole="owner"
        draftsCount={4}
      />
    );

    expect(screen.getByText('4')).toBeInTheDocument();

    rerender(
      <TabBar
        activeTab="drafts"
        onTabChange={vi.fn()}
        userRole="owner"
        draftsCount={14}
      />
    );

    expect(screen.getByText('9+')).toBeInTheDocument();
  });
});
