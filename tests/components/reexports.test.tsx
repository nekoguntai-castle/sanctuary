import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';

vi.mock('../../src/components/ConnectDevice/index', () => ({
  ConnectDevice: () => <div>Mock ConnectDevice</div>,
}));

vi.mock('../../src/components/TransactionList/index', () => ({
  TransactionList: () => <div>Mock TransactionList</div>,
}));

import { ConnectDevice } from '../../src/components/ConnectDevice';
import { TransactionList } from '../../src/components/TransactionList';

describe('wrapper re-exports', () => {
  it('re-exports ConnectDevice', () => {
    render(<ConnectDevice />);
    expect(screen.getByText('Mock ConnectDevice')).toBeInTheDocument();
  });

  it('re-exports TransactionList', () => {
    render(<TransactionList transactions={[]} />);
    expect(screen.getByText('Mock TransactionList')).toBeInTheDocument();
  });
});
