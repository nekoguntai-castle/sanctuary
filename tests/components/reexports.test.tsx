import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/ConnectDevice/index', () => ({
  ConnectDevice: () => <div>Mock ConnectDevice</div>,
}));

vi.mock('../../components/TransactionList/index', () => ({
  TransactionList: () => <div>Mock TransactionList</div>,
}));

import { ConnectDevice } from '../../components/ConnectDevice';
import { TransactionList } from '../../components/TransactionList';

describe('wrapper re-exports', () => {
  it('re-exports ConnectDevice', () => {
    render(<ConnectDevice />);
    expect(screen.getByText('Mock ConnectDevice')).toBeInTheDocument();
  });

  it('re-exports TransactionList', () => {
    render(<TransactionList />);
    expect(screen.getByText('Mock TransactionList')).toBeInTheDocument();
  });
});
