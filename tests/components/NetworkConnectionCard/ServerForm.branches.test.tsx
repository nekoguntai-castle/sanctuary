import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { ServerForm } from '../../../src/components/NetworkConnectionCard/ServerForm';

const colors = {
  bg: 'bg',
  border: 'border',
  text: 'text',
  accent: 'accent-class',
  badge: 'badge',
};

const presets = [
  { name: 'Preset A', host: 'a.example.com', port: 50002, useSsl: true },
  { name: 'Preset B', host: 'b.example.com', port: 60001, useSsl: false },
];

const buildProps = (overrides: Partial<React.ComponentProps<typeof ServerForm>> = {}) => ({
  editingServerId: null,
  newServer: {
    label: 'Server 1',
    host: 'electrum.example.com',
    port: 50001,
    useSsl: false,
  },
  serverActionLoading: null,
  colors,
  presets,
  onSetNewServer: vi.fn(),
  onAddPreset: vi.fn(),
  onCancel: vi.fn(),
  onSubmit: vi.fn(),
  ...overrides,
});

describe('NetworkConnectionCard ServerForm branch coverage', () => {
  it('covers port fallback parsing, ssl toggle, and preset selection', () => {
    const props = buildProps();
    render(<ServerForm {...props} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(props.onSetNewServer).toHaveBeenCalledWith({
      ...props.newServer,
      port: 50002,
    });

    expect(screen.getByRole('button', { name: 'TCP' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'TCP' }));
    expect(props.onSetNewServer).toHaveBeenCalledWith({
      ...props.newServer,
      useSsl: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preset A' }));
    expect(props.onAddPreset).toHaveBeenCalledWith(presets[0]);
  });

  it('covers add/edit submitting states and submit disabled guards', () => {
    const { rerender } = render(
      <ServerForm
        {...buildProps({
          newServer: { label: '', host: 'host-only', port: 50002, useSsl: true },
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Add Server' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SSL' }).className).toContain('accent-class');

    rerender(
      <ServerForm
        {...buildProps({
          serverActionLoading: 'add',
          newServer: { label: 'Label', host: 'host', port: 50002, useSsl: true },
        })}
      />
    );
    expect(screen.getByRole('button', { name: /Adding/i })).toBeDisabled();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();

    rerender(
      <ServerForm
        {...buildProps({
          editingServerId: 'srv-1',
          serverActionLoading: 'srv-1',
          newServer: { label: 'Label', host: 'host', port: 50002, useSsl: true },
        })}
      />
    );
    expect(screen.getByRole('button', { name: /Updating/i })).toBeDisabled();
  });
});
