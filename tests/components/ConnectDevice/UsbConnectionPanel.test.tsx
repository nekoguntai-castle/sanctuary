import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { UsbConnectionPanel } from '../../../components/ConnectDevice/UsbConnectionPanel';

const trezorModel = {
  id: 'trezor-t',
  slug: 'trezor-model-t',
  name: 'Trezor Model T',
  manufacturer: 'Trezor',
  connectivity: ['usb'],
  airGapped: false,
  secureElement: false,
  openSource: true,
  supportsBitcoinOnly: false,
  integrationTested: true,
} as any;

const ledgerModel = {
  id: 'ledger-ns',
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

function renderPanel(overrides: Record<string, unknown> = {}) {
  const onConnect = vi.fn();
  const props = {
    selectedModel: trezorModel,
    scanning: false,
    scanned: false,
    error: null,
    usbProgress: null,
    parsedAccountsCount: 0,
    fingerprint: 'f00dbeef',
    onConnect,
    ...overrides,
  };

  render(<UsbConnectionPanel {...props} />);
  return { props, onConnect };
}

describe('UsbConnectionPanel', () => {
  it('renders initial trezor hint and connects', async () => {
    const user = userEvent.setup();
    const { onConnect } = renderPanel();

    expect(screen.getByText(/Connect your Trezor Model T via USB/i)).toBeInTheDocument();
    expect(screen.getByText(/Trezor Suite/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Connect Device/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('renders non-trezor hint for other USB devices', () => {
    renderPanel({ selectedModel: ledgerModel });

    expect(screen.getByText(/Make sure the Bitcoin app is open on your device/i)).toBeInTheDocument();
  });

  it('renders error state and retries', async () => {
    const user = userEvent.setup();
    const { onConnect } = renderPanel({ error: 'USB permission denied' });

    expect(screen.getByText('USB permission denied')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try Again/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('renders scanning progress details', () => {
    renderPanel({
      scanning: true,
      usbProgress: { current: 2, total: 5, name: "m/84'/0'/1'" },
    });

    expect(screen.getByText(/Fetching m\/84'\/0'\/1'.../i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 5 derivation paths/i)).toBeInTheDocument();
    expect(screen.getByText(/Confirm each path on your device/i)).toBeInTheDocument();
  });

  it('guards zero-total scanning progress', () => {
    renderPanel({
      scanning: true,
      usbProgress: { current: 0, total: 0, name: "m/84'/0'/0'" },
    });

    expect(screen.getByTestId('usb-progress-bar')).toHaveStyle({ width: '0%' });
  });

  it('renders generic connecting text when scanning without progress', () => {
    renderPanel({ scanning: true, usbProgress: null });

    expect(screen.getByText(/Connecting to device/i)).toBeInTheDocument();
    expect(screen.getByText(/Please confirm on your device if prompted/i)).toBeInTheDocument();
  });

  it('renders success state for account fetch and fingerprint fallback', () => {
    const { rerender } = render(
      <UsbConnectionPanel
        selectedModel={trezorModel}
        scanning={false}
        scanned
        error={null}
        usbProgress={null}
        parsedAccountsCount={3}
        fingerprint="cafebabe"
        onConnect={vi.fn()}
      />
    );

    expect(screen.getByText(/3 derivation paths fetched/i)).toBeInTheDocument();

    rerender(
      <UsbConnectionPanel
        selectedModel={trezorModel}
        scanning={false}
        scanned
        error={null}
        usbProgress={null}
        parsedAccountsCount={0}
        fingerprint="cafebabe"
        onConnect={vi.fn()}
      />
    );

    expect(screen.getByText(/Fingerprint: cafebabe/i)).toBeInTheDocument();
  });
});
