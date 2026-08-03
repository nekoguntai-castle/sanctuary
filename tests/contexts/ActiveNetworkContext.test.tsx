import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActiveNetworkProvider,
  useActiveNetwork,
  useOptionalActiveNetwork,
} from '../../src/contexts/ActiveNetworkContext';

const preferenceState = vi.hoisted(() => ({
  storedNetwork: 'mainnet' as unknown,
  setStoredNetwork: vi.fn(),
}));

vi.mock('../../src/hooks/useUserPreference', () => ({
  useUserPreference: () => [
    preferenceState.storedNetwork,
    preferenceState.setStoredNetwork,
  ],
}));

function ActiveNetworkConsumer() {
  const { selectedNetwork, isMainnet, setSelectedNetwork } = useActiveNetwork();

  return (
    <div>
      <span data-testid="selected-network">{selectedNetwork}</span>
      <span data-testid="mainnet-state">{isMainnet ? 'mainnet' : 'not-mainnet'}</span>
      <button type="button" onClick={() => setSelectedNetwork('signet')}>
        Select Signet
      </button>
    </div>
  );
}

function OptionalActiveNetworkConsumer() {
  const context = useOptionalActiveNetwork();
  return <span data-testid="optional-network">{context?.selectedNetwork ?? 'none'}</span>;
}

function renderProvider() {
  return render(
    <ActiveNetworkProvider>
      <ActiveNetworkConsumer />
    </ActiveNetworkProvider>
  );
}

describe('ActiveNetworkProvider', () => {
  beforeEach(() => {
    preferenceState.storedNetwork = 'mainnet';
    preferenceState.setStoredNetwork.mockClear();
  });

  it('exposes the stored network preference and writes network changes', async () => {
    preferenceState.storedNetwork = 'testnet4';
    const user = userEvent.setup();

    renderProvider();

    expect(screen.getByTestId('selected-network')).toHaveTextContent('testnet4');
    expect(screen.getByTestId('mainnet-state')).toHaveTextContent('not-mainnet');

    await user.click(screen.getByRole('button', { name: 'Select Signet' }));

    expect(preferenceState.setStoredNetwork).toHaveBeenCalledWith('signet');
  });

  it('normalizes legacy stored testnet preference to testnet3', async () => {
    preferenceState.storedNetwork = 'testnet';

    renderProvider();

    expect(screen.getByTestId('selected-network')).toHaveTextContent('testnet3');
    expect(screen.getByTestId('mainnet-state')).toHaveTextContent('not-mainnet');
    await waitFor(() => {
      expect(preferenceState.setStoredNetwork).toHaveBeenCalledWith('testnet3');
    });
  });

  it('normalizes invalid stored values back to mainnet', async () => {
    preferenceState.storedNetwork = 'regtest';

    renderProvider();

    expect(screen.getByTestId('selected-network')).toHaveTextContent('mainnet');
    expect(screen.getByTestId('mainnet-state')).toHaveTextContent('mainnet');
    await waitFor(() => {
      expect(preferenceState.setStoredNetwork).toHaveBeenCalledWith('mainnet');
    });
  });

  it('returns undefined from optional hook outside the provider', () => {
    render(<OptionalActiveNetworkConsumer />);

    expect(screen.getByTestId('optional-network')).toHaveTextContent('none');
  });

  it('throws from required hook outside the provider', () => {
    const RequiredConsumer = () => {
      useActiveNetwork();
      return null;
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<RequiredConsumer />)).toThrow(
      'useActiveNetwork must be used within an ActiveNetworkProvider'
    );

    consoleSpy.mockRestore();
  });
});
