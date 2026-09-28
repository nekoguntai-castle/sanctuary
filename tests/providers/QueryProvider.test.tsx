import { useQueryClient } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { useCreateWallet,useWallets } from '../../src/hooks/queries/useWallets';
import * as walletsApi from '../../src/api/wallets';
import type { CreateWalletRequest } from '../../src/api/wallets';
import { QueryProvider,getQueryClient } from '../../src/providers/QueryProvider';

vi.mock('../../src/api/wallets', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/api/wallets')>(),
  createWallet: vi.fn(),
  getWallets: vi.fn(),
}));

const createWalletMock = vi.mocked(walletsApi.createWallet);
const getWalletsMock = vi.mocked(walletsApi.getWallets);
const createWalletPayload = {
  name: 'Committed wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
} satisfies CreateWalletRequest;

afterEach(() => {
  getQueryClient().clear();
  createWalletMock.mockReset();
  getWalletsMock.mockReset();
});

const ClientProbe: React.FC = () => {
  const client = useQueryClient();
  return <div data-testid="client-match">{String(client === getQueryClient())}</div>;
};

const CreateWalletProbe: React.FC = () => {
  const mutation = useCreateWallet();
  return (
    <>
      <button onClick={() => mutation.mutate(createWalletPayload)}>
        Create wallet
      </button>
      <div data-testid="mutation-status">{mutation.status}</div>
      <div data-testid="mutation-error">{mutation.error?.message ?? ''}</div>
    </>
  );
};

const WalletsProbe: React.FC = () => {
  const query = useWallets();
  return <div data-testid="wallet-query-status">{query.status}</div>;
};

describe('QueryProvider', () => {
  it('provides the shared query client instance to children', () => {
    render(
      <QueryProvider>
        <ClientProbe />
      </QueryProvider>
    );

    expect(screen.getByTestId('client-match')).toHaveTextContent('true');
  });

  it('does not replay a wallet create after the server may have committed it', async () => {
    let committedEffects = 0;
    createWalletMock.mockImplementation(async () => {
      committedEffects += 1;
      throw new TypeError('response was lost after commit');
    });

    render(
      <QueryProvider>
        <CreateWalletProbe />
      </QueryProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
    await waitFor(() => expect(screen.getByTestId('mutation-status').textContent).toBe('error'), { timeout: 5_000 });

    expect(committedEffects).toBe(1);
    expect(createWalletMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mutation-error').textContent).toContain('response was lost after commit');
  });

  it('retries a transient wallet list read through the shared provider', async () => {
    getWalletsMock
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce([]);

    render(
      <QueryProvider>
        <WalletsProbe />
      </QueryProvider>
    );

    await waitFor(() => expect(screen.getByTestId('wallet-query-status').textContent).toBe('success'), { timeout: 5_000 });
    expect(getWalletsMock).toHaveBeenCalledTimes(2);
  });
});
