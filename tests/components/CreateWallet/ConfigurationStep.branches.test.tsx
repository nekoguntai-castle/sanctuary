import { fireEvent,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { ConfigurationStep } from '../../../components/CreateWallet/ConfigurationStep';
import { WalletType } from '../../../types';

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="check-icon" />,
}));

describe('ConfigurationStep branch coverage', () => {
  const baseProps = {
    walletType: WalletType.SINGLE_SIG,
    walletName: '',
    setWalletName: vi.fn(),
    network: 'mainnet' as const,
    setNetwork: vi.fn(),
    scriptType: 'native_segwit' as const,
    setScriptType: vi.fn(),
    quorumM: 2,
    setQuorumM: vi.fn(),
    selectedDeviceCount: 3,
  };

  it('shows single-sig placeholder and no network warning on mainnet', () => {
    render(<ConfigurationStep {...baseProps} />);

    expect(screen.getByPlaceholderText('e.g., My ColdCard Wallet')).toBeInTheDocument();
    expect(screen.queryByText(/This wallet will operate on/i)).not.toBeInTheDocument();
  });

  it('shows testnet warning message and styling branch', () => {
    render(<ConfigurationStep {...baseProps} network="testnet" />);

    const warning = screen.getByText(/This wallet will operate on testnet/i);
    expect(warning).toBeInTheDocument();
    expect(warning.closest('div')).toHaveClass('dark:text-testnet-950');
    expect(screen.getByText(/Testnet coins have no real-world value/i)).toBeInTheDocument();
  });

  it('shows signet warning message branch', () => {
    render(<ConfigurationStep {...baseProps} network="signet" />);

    const warning = screen.getByText(/This wallet will operate on signet/i);
    expect(warning).toBeInTheDocument();
    expect(warning.closest('div')).toHaveClass('dark:text-signet-950');
    expect(screen.getByText(/Signet is a controlled testing network/i)).toBeInTheDocument();
  });

  it('calls setNetwork when selecting each network option', async () => {
    const user = userEvent.setup();
    const setNetwork = vi.fn();
    render(<ConfigurationStep {...baseProps} setNetwork={setNetwork} />);

    await user.click(screen.getByRole('button', { name: 'Mainnet' }));
    await user.click(screen.getByRole('button', { name: 'Testnet' }));
    await user.click(screen.getByRole('button', { name: 'Signet' }));

    expect(setNetwork).toHaveBeenNthCalledWith(1, 'mainnet');
    expect(setNetwork).toHaveBeenNthCalledWith(2, 'testnet');
    expect(setNetwork).toHaveBeenNthCalledWith(3, 'signet');
  });

  it('calls setScriptType for all script options in single-sig mode', async () => {
    const user = userEvent.setup();
    const setScriptType = vi.fn();
    render(<ConfigurationStep {...baseProps} setScriptType={setScriptType} />);

    await user.click(screen.getByRole('button', { name: /Native Segwit/i }));
    await user.click(screen.getByRole('button', { name: /Taproot/i }));
    await user.click(screen.getByRole('button', { name: /Nested Segwit/i }));
    await user.click(screen.getByRole('button', { name: /Legacy/i }));

    expect(setScriptType).toHaveBeenNthCalledWith(1, 'native_segwit');
    expect(setScriptType).toHaveBeenNthCalledWith(2, 'taproot');
    expect(setScriptType).toHaveBeenNthCalledWith(3, 'nested_segwit');
    expect(setScriptType).toHaveBeenNthCalledWith(4, 'legacy');
  });

  it('renders multisig placeholder, hides script section, and updates quorum slider', async () => {
    const setQuorumM = vi.fn();

    render(
      <ConfigurationStep
        {...baseProps}
        walletType={WalletType.MULTI_SIG}
        network="mainnet"
        setQuorumM={setQuorumM}
      />
    );

    expect(screen.getByPlaceholderText('e.g., Family Savings')).toBeInTheDocument();
    expect(screen.queryByText('Script Type')).not.toBeInTheDocument();

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(setQuorumM).toHaveBeenCalledWith(1);
  });
});
