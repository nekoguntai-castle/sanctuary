import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { ConnectionMethodSelector } from '../../../src/components/ConnectDevice/ConnectionMethodSelector';

vi.mock('../../../src/components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
}));

vi.mock('../../../src/components/ConnectDevice/DeviceModelSelector', () => ({
  renderCapabilities: () => <span data-testid="capability-pill">capability</span>,
}));

const baseModel = {
  id: 'model-1',
  slug: 'ledger',
  name: 'Ledger Nano S',
  manufacturer: 'Ledger',
  connectivity: ['usb', 'unknown_conn'],
  airGapped: false,
  secureElement: true,
  openSource: false,
  supportsBitcoinOnly: false,
  integrationTested: false,
} as any;

describe('ConnectionMethodSelector branch coverage', () => {
  it('covers untested warning and skips unknown connectivity/method branches', () => {
    const onSelectMethod = vi.fn();

    render(
      <ConnectionMethodSelector
        selectedModel={baseModel}
        selectedMethod="usb"
        availableMethods={['usb', 'manual', 'unknown_method' as any]}
        onSelectMethod={onSelectMethod}
      />,
    );

    expect(screen.getByText('Untested Device')).toBeInTheDocument();
    expect(screen.getByTestId('device-icon')).toBeInTheDocument();
    expect(screen.getByTestId('capability-pill')).toBeInTheDocument();

    // Unknown method does not render a button because config is missing.
    expect(screen.queryByText('unknown_method')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Manual Entry/i }));
    expect(onSelectMethod).toHaveBeenCalledWith('manual');
  });
});
