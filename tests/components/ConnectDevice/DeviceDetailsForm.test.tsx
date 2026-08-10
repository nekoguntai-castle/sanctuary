import { fireEvent,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { DeviceDetailsForm } from '../../../src/components/ConnectDevice/DeviceDetailsForm';

const selectedModel = {
  id: 'model-1',
  slug: 'ledger-nano-s',
  name: 'Ledger Nano S',
  manufacturer: 'Ledger',
  connectivity: ['usb'],
  airGapped: false,
  secureElement: true,
  openSource: false,
  supportsBitcoinOnly: false,
  integrationTested: true,
} as any;

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    selectedModel,
    method: null,
    scanned: false,
    formData: {
      label: 'My Device',
      xpub: '',
      fingerprint: '',
      derivationPath: "m/84'/0'/0'",
      parsedAccounts: [],
      selectedAccounts: new Set<number>(),
    },
    saving: false,
    error: null,
    warning: null,
    qrExtractedFields: null,
    showQrDetails: false,
    onFormDataChange: vi.fn(),
    onToggleAccount: vi.fn(),
    onToggleQrDetails: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  } as any;
}

describe('DeviceDetailsForm', () => {
  it('renders placeholder state when no model selected', () => {
    render(<DeviceDetailsForm {...createProps({ selectedModel: null })} />);
    expect(screen.getByText(/Select a device to continue/i)).toBeInTheDocument();
  });

  it('allows editing labels before a connection completes', () => {
    const props = createProps();
    render(<DeviceDetailsForm {...props} />);

    fireEvent.change(screen.getByDisplayValue('My Device'), { target: { value: 'Renamed Device' } });
    expect(props.onFormDataChange).toHaveBeenCalledWith({ label: 'Renamed Device' });
  });

  it('renders parsed account list, toggles accounts, and saves', async () => {
    const user = userEvent.setup();
    const props = createProps({
      method: 'usb',
      scanned: true,
      formData: {
        label: 'Ledger Nano S',
        xpub: '',
        fingerprint: 'f00dbeef',
        derivationPath: "m/84'/0'/0'",
        parsedAccounts: [
          {
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub661MyMwAqRbcFAKEACCOUNTAAAA00000011111111',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
          },
          {
            derivationPath: "m/86'/0'/0'",
            xpub: 'xpub661MyMwAqRbcFAKEACCOUNTBBBB22222233333333',
            purpose: 'multisig',
            scriptType: 'taproot',
          },
        ],
        selectedAccounts: new Set<number>([0]),
      },
    });

    render(<DeviceDetailsForm {...props} />);

    expect(screen.getByText(/Accounts to Import/i)).toBeInTheDocument();
    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
    expect(screen.getByText('Single-sig')).toBeInTheDocument();
    expect(screen.getByText('Multisig')).toBeInTheDocument();
    expect(screen.getByText('Native SegWit')).toBeInTheDocument();
    expect(screen.getByText('Taproot')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]!);
    expect(props.onToggleAccount).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole('button', { name: /Save Device/i }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it('collapses testnet and signet accounts and toggles them after expansion', async () => {
    const user = userEvent.setup();
    const props = createProps({
      method: 'usb',
      scanned: true,
      formData: {
        label: 'Ledger Nano S',
        xpub: '',
        fingerprint: 'f00dbeef',
        derivationPath: "m/84'/0'/0'",
        parsedAccounts: [
          {
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub-mainnet',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
          },
          {
            derivationPath: "m/84'/1'/0'",
            xpub: 'tpub-testnet',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
          },
          {
            derivationPath: "m/86'/1'/0'",
            xpub: 'tpub-signet',
            purpose: 'single_sig',
            scriptType: 'taproot',
          },
        ],
        selectedAccounts: new Set<number>([0, 2]),
      },
    });

    render(<DeviceDetailsForm {...props} />);

    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
    expect(screen.queryByText("m/84'/1'/0'")).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 paths selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /testnet-family \/ signet derivation paths/i }));

    expect(screen.getByText("m/84'/1'/0'")).toBeInTheDocument();
    expect(screen.getByText("m/86'/1'/0'")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]!);
    expect(props.onToggleAccount).toHaveBeenCalledWith(1);
  });

  it('uses singular copy when one testnet or signet account is hidden', () => {
    render(
      <DeviceDetailsForm
        {...createProps({
          method: 'usb',
          scanned: true,
          formData: {
            label: 'Ledger Nano S',
            xpub: '',
            fingerprint: 'f00dbeef',
            derivationPath: "m/84'/0'/0'",
            parsedAccounts: [
              {
                derivationPath: "m/84'/1'/0'",
                xpub: 'tpub-testnet',
                purpose: 'single_sig',
                scriptType: 'native_segwit',
              },
            ],
            selectedAccounts: new Set<number>(),
          },
        })}
      />,
    );

    expect(screen.getByText('0 of 1 path selected')).toBeInTheDocument();
    expect(screen.queryByText("m/84'/1'/0'")).not.toBeInTheDocument();
  });

  it('shows helper message when parsed accounts exist but none are selected', () => {
    render(
      <DeviceDetailsForm
        {...createProps({
          method: 'usb',
          scanned: true,
          formData: {
            label: 'Ledger Nano S',
            xpub: '',
            fingerprint: 'f00dbeef',
            derivationPath: "m/84'/0'/0'",
            parsedAccounts: [
              {
                derivationPath: "m/84'/0'/0'",
                xpub: 'xpub661MyMwAqRbcFAKEACCOUNTAAAA00000011111111',
                purpose: 'single_sig',
                scriptType: 'native_segwit',
              },
            ],
            selectedAccounts: new Set<number>(),
          },
        })}
      />
    );

    expect(screen.getByText(/Select at least one account to import/i)).toBeInTheDocument();
  });
});
