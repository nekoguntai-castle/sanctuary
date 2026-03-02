import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceModelSelector, renderCapabilities } from '../../../components/ConnectDevice/DeviceModelSelector';
import type { HardwareDeviceModel } from '../../../src/api/devices';

vi.mock('../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
}));

const makeModel = (overrides: Partial<HardwareDeviceModel> = {}): HardwareDeviceModel => ({
  id: 'model-1',
  name: 'Ledger Nano',
  slug: 'ledger-nano',
  manufacturer: 'Ledger',
  connectivity: ['usb'],
  secureElement: true,
  openSource: false,
  airGapped: false,
  supportsBitcoinOnly: true,
  supportsMultisig: true,
  supportsTaproot: true,
  supportsPassphrase: true,
  scriptTypes: ['native_segwit'],
  hasScreen: true,
  integrationTested: true,
  discontinued: false,
  ...overrides,
});

describe('DeviceModelSelector', () => {
  it('handles search/filter/model selection and clears active search text', async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    const onSelectManufacturer = vi.fn();
    const onSearchChange = vi.fn();

    const models = [
      makeModel(),
      makeModel({
        id: 'model-2',
        name: 'Passport',
        manufacturer: 'Foundation',
        integrationTested: false,
      }),
    ];

    render(
      <DeviceModelSelector
        models={models}
        manufacturers={['Ledger', 'Foundation']}
        selectedModel={models[0]}
        selectedManufacturer="Ledger"
        searchQuery="ledger"
        onSelectModel={onSelectModel}
        onSelectManufacturer={onSelectManufacturer}
        onSearchChange={onSearchChange}
        onClearFilters={vi.fn()}
      />
    );

    expect(screen.getByText('2 devices')).toBeInTheDocument();
    expect(screen.getByText('Untested')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search devices...'), ' x');
    expect(onSearchChange).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Foundation' }));
    expect(onSelectManufacturer).toHaveBeenCalledWith('Foundation');

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onSelectManufacturer).toHaveBeenCalledWith(null);

    await user.click(screen.getByRole('button', { name: /ledger nano/i }));
    expect(onSelectModel).toHaveBeenCalledWith(models[0]);

    const clearSearchButton = screen.getByRole('button', { name: '' });
    await user.click(clearSearchButton);
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('shows empty state and clears filters when no models match', async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();

    render(
      <DeviceModelSelector
        models={[]}
        manufacturers={[]}
        selectedModel={null}
        selectedManufacturer={null}
        searchQuery=""
        onSelectModel={vi.fn()}
        onSelectManufacturer={vi.fn()}
        onSearchChange={vi.fn()}
        onClearFilters={onClearFilters}
      />
    );

    expect(screen.getByText('No devices match your search')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('renders capability badges based on model feature flags', () => {
    const secureModel = makeModel({
      airGapped: true,
      secureElement: true,
      openSource: false,
      supportsBitcoinOnly: true,
    });
    const { rerender } = render(<>{renderCapabilities(secureModel)}</>);

    expect(screen.getByText('Air-Gapped')).toBeInTheDocument();
    expect(screen.getByText('Secure Element')).toBeInTheDocument();
    expect(screen.getByText('Bitcoin Only')).toBeInTheDocument();
    expect(screen.queryByText('Open Source')).not.toBeInTheDocument();

    rerender(
      <>
        {renderCapabilities(
          makeModel({
            airGapped: false,
            secureElement: false,
            openSource: true,
            supportsBitcoinOnly: false,
          })
        )}
      </>
    );

    expect(screen.getByText('Open Source')).toBeInTheDocument();
    expect(screen.queryByText('Secure Element')).not.toBeInTheDocument();
  });
});
