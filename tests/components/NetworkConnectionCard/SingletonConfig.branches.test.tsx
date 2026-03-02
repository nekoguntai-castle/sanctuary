import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SingletonConfig } from '../../../components/NetworkConnectionCard/SingletonConfig';
import type { PresetServer } from '../../../components/NetworkConnectionCard/types';

vi.mock('lucide-react', () => ({
  Loader2: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="loader-icon" {...props} />,
  CheckCircle: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="check-icon" {...props} />,
  XCircle: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="x-icon" {...props} />,
}));

const colors = {
  bg: 'bg-mainnet/10',
  border: 'border-mainnet/40',
  text: 'text-mainnet',
  accent: 'bg-mainnet text-white',
  badge: 'bg-mainnet/20 text-mainnet',
};

const presets: PresetServer[] = [
  { name: 'Preset A', host: 'a.example.com', port: 51002, useSsl: true },
  { name: 'Preset B', host: 'b.example.com', port: 50001, useSsl: false },
];

const renderConfig = (overrides: Partial<React.ComponentProps<typeof SingletonConfig>> = {}) => {
  const onUpdateConfig = vi.fn();
  const onTestSingleton = vi.fn();

  const view = render(
    <SingletonConfig
      singletonHost="electrum.example.com"
      singletonPort={50002}
      singletonSsl={true}
      colors={colors}
      presets={presets}
      testStatus="idle"
      testMessage=""
      onUpdateConfig={onUpdateConfig}
      onTestSingleton={onTestSingleton}
      {...overrides}
    />
  );

  return { ...view, onUpdateConfig, onTestSingleton };
};

describe('SingletonConfig branch coverage', () => {
  it('covers port parsing fallback, protocol toggles, and preset updates', () => {
    const { onUpdateConfig } = renderConfig();

    const portInput = screen.getByRole('spinbutton');
    fireEvent.change(portInput, { target: { value: '60001' } });
    fireEvent.change(portInput, { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: 'SSL' }));
    fireEvent.click(screen.getByRole('button', { name: 'TCP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preset B' }));

    expect(onUpdateConfig).toHaveBeenCalledWith('singletonPort', 60001);
    expect(onUpdateConfig).toHaveBeenCalledWith('singletonPort', 50002);
    expect(onUpdateConfig).toHaveBeenCalledWith('singletonSsl', true);
    expect(onUpdateConfig).toHaveBeenCalledWith('singletonSsl', false);
    expect(onUpdateConfig).toHaveBeenCalledWith('singletonHost', 'b.example.com');
    expect(onUpdateConfig).toHaveBeenCalledWith('singletonPort', 50001);
  });

  it('covers status UI branches for testing/success/error and ssl class toggles', () => {
    const { rerender, onTestSingleton } = renderConfig({
      testStatus: 'testing',
      singletonSsl: true,
    });

    const sslButton = screen.getByRole('button', { name: 'SSL' });
    const tcpButton = screen.getByRole('button', { name: 'TCP' });
    const testButton = screen.getByRole('button', { name: /Testing/ });

    expect(sslButton.className).toContain('bg-mainnet text-white');
    expect(tcpButton.className).toContain('bg-sanctuary-100');
    expect(testButton).toBeDisabled();
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();

    rerender(
      <SingletonConfig
        singletonHost="electrum.example.com"
        singletonPort={50002}
        singletonSsl={false}
        colors={colors}
        presets={presets}
        testStatus="success"
        testMessage="connected"
        onUpdateConfig={vi.fn()}
        onTestSingleton={onTestSingleton}
      />
    );

    const successMessage = screen.getByText('connected').closest('div');
    expect(successMessage?.className).toContain('bg-green-50');
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TCP' }).className).toContain('bg-mainnet text-white');

    rerender(
      <SingletonConfig
        singletonHost="electrum.example.com"
        singletonPort={50002}
        singletonSsl={false}
        colors={colors}
        presets={presets}
        testStatus="error"
        testMessage="failed"
        onUpdateConfig={vi.fn()}
        onTestSingleton={onTestSingleton}
      />
    );

    const errorMessage = screen.getByText('failed').closest('div');
    expect(errorMessage?.className).toContain('bg-red-50');
    expect(screen.getByTestId('x-icon')).toBeInTheDocument();
  });
});
