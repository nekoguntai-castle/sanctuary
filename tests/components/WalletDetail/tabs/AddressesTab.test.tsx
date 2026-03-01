import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressesTab } from '../../../../components/WalletDetail/tabs/AddressesTab';

const copyMock = vi.fn();
const isCopiedMock = vi.fn(() => false);

vi.mock('../../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (value: number) => `${value} sats`,
  }),
}));

vi.mock('../../../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: copyMock,
    isCopied: isCopiedMock,
  }),
}));

describe('AddressesTab', () => {
  const baseProps = {
    addresses: [],
    addressSummary: {
      totalAddresses: 0,
      usedCount: 0,
      unusedCount: 0,
      totalBalance: 0,
      usedBalance: 0,
      unusedBalance: 0,
    },
    addressSubTab: 'receive' as const,
    onAddressSubTabChange: vi.fn(),
    descriptor: null,
    network: 'mainnet',
    loadingAddresses: false,
    hasMoreAddresses: false,
    onLoadMoreAddresses: vi.fn(),
    onGenerateMoreAddresses: vi.fn(),
    editingAddressId: null,
    availableLabels: [],
    selectedLabelIds: [],
    onEditAddressLabels: vi.fn(),
    onSaveAddressLabels: vi.fn(),
    onToggleAddressLabel: vi.fn(),
    savingAddressLabels: false,
    onCancelEditLabels: vi.fn(),
    onShowQrModal: vi.fn(),
    explorerUrl: 'https://mempool.space',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isCopiedMock.mockReturnValue(false);
  });

  it('shows empty state without generate button when descriptor is missing', () => {
    render(<AddressesTab {...baseProps} />);
    expect(screen.getByText('No Addresses Available')).toBeInTheDocument();
    expect(screen.queryByText('Generate Addresses')).not.toBeInTheDocument();
  });

  it('shows generate button for wallets with descriptors', () => {
    render(<AddressesTab {...baseProps} descriptor="wpkh(...)" />);
    fireEvent.click(screen.getByText('Generate Addresses'));
    expect(baseProps.onGenerateMoreAddresses).toHaveBeenCalled();
  });

  it('renders address table actions and load-more control', () => {
    const addresses = [
      {
        id: 'addr-1',
        address: 'bc1qreceive000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
        balance: 10_000,
        labels: [],
      },
    ];

    render(
      <AddressesTab
        {...baseProps}
        addresses={addresses as any}
        descriptor="wpkh(...)"
        hasMoreAddresses
      />
    );

    fireEvent.click(screen.getByTitle('Copy address'));
    fireEvent.click(screen.getByTitle('Show QR code'));
    fireEvent.click(screen.getByText('Load More'));

    expect(copyMock).toHaveBeenCalled();
    expect(baseProps.onShowQrModal).toHaveBeenCalledWith(addresses[0].address);
    expect(baseProps.onLoadMoreAddresses).toHaveBeenCalled();
  });

  it('switches address sub-tabs', () => {
    const addresses = [
      {
        id: 'addr-1',
        address: 'bc1qreceive000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
        balance: 0,
        labels: [],
      },
    ];

    render(<AddressesTab {...baseProps} addresses={addresses as any} descriptor="wpkh(...)" />);
    fireEvent.click(screen.getByText('Change'));
    expect(baseProps.onAddressSubTabChange).toHaveBeenCalledWith('change');
  });

  it('renders change addresses based on derivation path fallback', () => {
    const addresses = [
      {
        id: 'addr-receive',
        address: 'bc1qreceive000000000000000000000000000000001',
        derivationPath: "m/84'/0'/0'/0/1",
        index: 1,
        used: false,
        balance: 0,
        labels: [],
      },
      {
        id: 'addr-change',
        address: 'bc1qchange0000000000000000000000000000000002',
        derivationPath: "m/84'/0'/0'/1/2",
        index: 2,
        used: true,
        balance: 0,
        labels: [],
      },
    ];

    render(
      <AddressesTab
        {...baseProps}
        addresses={addresses as any}
        descriptor="wpkh(...)"
        addressSubTab="change"
      />
    );

    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('supports editing address labels with save/cancel and label toggles', () => {
    const addresses = [
      {
        id: 'addr-1',
        address: 'bc1qedit00000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/3",
        index: 3,
        used: false,
        balance: 0,
        labels: [],
      },
    ];
    const onToggleAddressLabel = vi.fn();
    const onSaveAddressLabels = vi.fn();
    const onCancelEditLabels = vi.fn();

    render(
      <AddressesTab
        {...baseProps}
        addresses={addresses as any}
        descriptor="wpkh(...)"
        editingAddressId="addr-1"
        selectedLabelIds={['label-1']}
        availableLabels={[
          { id: 'label-1', name: 'VIP', color: '#00aa00' },
          { id: 'label-2', name: 'Ops', color: '#0000aa' },
        ] as any}
        onToggleAddressLabel={onToggleAddressLabel}
        onSaveAddressLabels={onSaveAddressLabels}
        onCancelEditLabels={onCancelEditLabels}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'VIP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ops' }));
    fireEvent.click(screen.getByTitle('Save'));
    fireEvent.click(screen.getByTitle('Cancel'));

    expect(onToggleAddressLabel).toHaveBeenCalledWith('label-1');
    expect(onToggleAddressLabel).toHaveBeenCalledWith('label-2');
    expect(onSaveAddressLabels).toHaveBeenCalledTimes(1);
    expect(onCancelEditLabels).toHaveBeenCalledTimes(1);
  });

  it('shows no-label fallback states and opens label edit mode', () => {
    const addresses = [
      {
        id: 'addr-1',
        address: 'bc1qlabel0000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
        balance: 0,
        labels: [],
        label: 'Primary',
      },
      {
        id: 'addr-2',
        address: 'bc1qnone00000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/1",
        index: 1,
        used: false,
        balance: 0,
        labels: [],
      },
    ];

    render(<AddressesTab {...baseProps} addresses={addresses as any} descriptor="wpkh(...)" />);

    fireEvent.click(screen.getAllByTitle('Edit labels')[0]);
    expect(baseProps.onEditAddressLabels).toHaveBeenCalledWith(expect.objectContaining({ id: 'addr-1' }));
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('shows copied state and all-addresses-loaded footer', () => {
    isCopiedMock.mockImplementation((value: string) => value.includes('copied'));
    const addresses = [
      {
        id: 'addr-copied',
        address: 'bc1qcopied000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: true,
        balance: 0,
        labels: [],
      },
    ];

    render(
      <AddressesTab
        {...baseProps}
        addresses={addresses as any}
        descriptor="wpkh(...)"
        hasMoreAddresses={false}
      />
    );

    expect(screen.getByTitle('Copied!')).toBeInTheDocument();
    expect(screen.getByText('All addresses loaded')).toBeInTheDocument();
  });

  it('shows no-labels-available and loading save state while editing', () => {
    const addresses = [
      {
        id: 'addr-1',
        address: 'bc1qsave00000000000000000000000000000000000',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
        balance: 1,
        labels: [],
      },
    ];

    render(
      <AddressesTab
        {...baseProps}
        addresses={addresses as any}
        descriptor="wpkh(...)"
        editingAddressId="addr-1"
        availableLabels={[]}
        savingAddressLabels
      />
    );

    expect(screen.getByText('No labels available')).toBeInTheDocument();
    expect(screen.getByTitle('Save')).toBeDisabled();
  });

  it('handles explicit isChange flags, short derivation paths, and switching back to receive tab', () => {
    const addresses = [
      {
        id: 'addr-change-explicit',
        address: 'bc1qexplicitchange0000000000000000000000000',
        derivationPath: 'm',
        isChange: true,
        index: 0,
        used: false,
        balance: 0,
        labels: [],
      },
      {
        id: 'addr-receive-explicit',
        address: 'bc1qexplicitreceive000000000000000000000000',
        derivationPath: 'm',
        isChange: false,
        index: 1,
        used: false,
        balance: 0,
        labels: [],
      },
      {
        id: 'addr-short-path',
        address: 'bc1qshortpath000000000000000000000000000000',
        derivationPath: 'm',
        index: 2,
        used: false,
        balance: 0,
        labels: [],
      },
    ];

    render(
      <AddressesTab
        {...baseProps}
        addresses={addresses as any}
        descriptor="wpkh(...)"
        addressSubTab="change"
      />
    );

    expect(screen.getByText('#0')).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Receive'));
    expect(baseProps.onAddressSubTabChange).toHaveBeenCalledWith('receive');
  });
});
