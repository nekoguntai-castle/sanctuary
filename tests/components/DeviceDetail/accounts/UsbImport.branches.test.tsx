import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UsbImport } from '../../../../components/DeviceDetail/accounts/UsbImport';

describe('DeviceDetail UsbImport branch coverage', () => {
  it('covers loading with and without usbProgress plus connect action', () => {
    const onConnect = vi.fn();
    const { rerender } = render(
      <UsbImport
        deviceType="Coldcard"
        addAccountLoading
        usbProgress={null}
        onConnect={onConnect}
      />
    );

    expect(screen.getByText('Connecting to device...')).toBeInTheDocument();

    rerender(
      <UsbImport
        deviceType="Coldcard"
        addAccountLoading
        usbProgress={{ current: 2, total: 4, name: "m/84'/0'/0'" }}
        onConnect={onConnect}
      />
    );

    expect(screen.getByText("Fetching m/84'/0'/0'...")).toBeInTheDocument();
    expect(screen.getByText('2 of 4 paths')).toBeInTheDocument();
    expect(document.querySelector('div[style*="width: 50%"]')).toBeInTheDocument();

    rerender(
      <UsbImport
        deviceType="Coldcard"
        addAccountLoading={false}
        usbProgress={null}
        onConnect={onConnect}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Device' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
