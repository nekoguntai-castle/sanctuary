import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PoolConfig } from '../../../components/NetworkConnectionCard/PoolConfig';

const renderPoolConfig = (
  overrides: Partial<React.ComponentProps<typeof PoolConfig>> = {},
) => {
  const onUpdateConfig = vi.fn();

  render(
    <PoolConfig
      servers={[]}
      poolStats={null}
      colors={{ primary: 'text-primary-500', bg: 'bg-primary-500' } as any}
      presets={[]}
      showAdvanced
      isAddingServer={false}
      editingServerId={null}
      newServer={{ label: '', host: '', port: 50002, useSsl: true }}
      serverActionLoading={null}
      serverTestStatus={{}}
      poolMin={1}
      poolMax={5}
      poolLoadBalancing="round_robin"
      onToggleAdvanced={vi.fn()}
      onUpdateConfig={onUpdateConfig}
      onSetIsAddingServer={vi.fn()}
      onSetEditingServerId={vi.fn()}
      onSetNewServer={vi.fn()}
      onTestServer={vi.fn()}
      onToggleServer={vi.fn()}
      onMoveServer={vi.fn()}
      onEditServer={vi.fn()}
      onDeleteServer={vi.fn()}
      onAddPreset={vi.fn()}
      onAddServer={vi.fn()}
      onUpdateServer={vi.fn()}
      onCancelEdit={vi.fn()}
      getDefaultPort={() => 50002}
      getServerPoolStats={() => undefined}
      {...overrides}
    />
  );

  return { onUpdateConfig };
};

describe('PoolConfig branch coverage', () => {
  it('uses fallback defaults when min/max input values parse to falsy numbers', () => {
    const { onUpdateConfig } = renderPoolConfig();
    const [minInput, maxInput] = screen.getAllByRole('spinbutton');

    fireEvent.change(minInput, { target: { value: '0' } });
    fireEvent.change(maxInput, { target: { value: '0' } });

    expect(onUpdateConfig).toHaveBeenCalledWith('poolMin', 1);
    expect(onUpdateConfig).toHaveBeenCalledWith('poolMax', 5);
  });

  it('passes parsed min/max values through when numbers are valid', () => {
    const { onUpdateConfig } = renderPoolConfig();
    const [minInput, maxInput] = screen.getAllByRole('spinbutton');

    fireEvent.change(minInput, { target: { value: '3' } });
    fireEvent.change(maxInput, { target: { value: '12' } });

    expect(onUpdateConfig).toHaveBeenCalledWith('poolMin', 3);
    expect(onUpdateConfig).toHaveBeenCalledWith('poolMax', 12);
  });

  it('covers empty-state preset add callback', () => {
    const onAddPreset = vi.fn();
    renderPoolConfig({
      presets: [{ name: 'Mempool Space', host: 'mempool.space', port: 50002, useSsl: true }],
      onAddPreset,
      showAdvanced: false,
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ mempool space/i }));
    expect(onAddPreset).toHaveBeenCalledWith({
      name: 'Mempool Space',
      host: 'mempool.space',
      port: 50002,
      useSsl: true,
    });
  });
});
