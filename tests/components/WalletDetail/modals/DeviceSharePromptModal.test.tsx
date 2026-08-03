import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { DeviceSharePromptModal } from '../../../../src/components/WalletDetail/modals/DeviceSharePromptModal';

function createPrompt(overrides: Record<string, unknown> = {}) {
  return {
    show: true,
    targetUsername: 'alice',
    devices: [
      { id: 'd1', label: 'Passport', fingerprint: 'deadbeef' },
      { id: 'd2', label: 'Coldcard', fingerprint: 'cafebabe' },
    ],
    ...overrides,
  } as any;
}

describe('DeviceSharePromptModal', () => {
  it('does not render when prompt is hidden', () => {
    render(
      <DeviceSharePromptModal
        deviceSharePrompt={createPrompt({ show: false })}
        sharingLoading={false}
        onDismiss={vi.fn()}
        onShareDevices={vi.fn()}
      />
    );

    expect(screen.queryByText(/Share Devices\?/i)).not.toBeInTheDocument();
  });

  it('renders devices and triggers actions', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onShareDevices = vi.fn();

    render(
      <DeviceSharePromptModal
        deviceSharePrompt={createPrompt()}
        sharingLoading={false}
        onDismiss={onDismiss}
        onShareDevices={onShareDevices}
      />
    );

    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText('Passport')).toBeInTheDocument();
    expect(screen.getByText('Coldcard')).toBeInTheDocument();
    expect(screen.getByText('deadbeef')).toBeInTheDocument();
    expect(screen.getByText('cafebabe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Skip/i }));
    await user.click(screen.getByRole('button', { name: /Share Devices/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onShareDevices).toHaveBeenCalledTimes(1);
  });

  it('shows loading state and disables actions while sharing', () => {
    render(
      <DeviceSharePromptModal
        deviceSharePrompt={createPrompt()}
        sharingLoading
        onDismiss={vi.fn()}
        onShareDevices={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Skip/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Sharing/i })).toBeDisabled();
  });
});

