import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationSoundSettings } from '../../../../components/Settings/sections/SoundSection';

const mockState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    preferences: {
      notificationSounds: {
        enabled: true,
        volume: 50,
        confirmation: { enabled: true, sound: 'chime' },
        receive: { enabled: true, sound: 'chime' },
        send: { enabled: false, sound: 'none' },
      },
    },
  } as any,
  updatePreferences: vi.fn(),
  playSound: vi.fn(),
  getEventConfig: vi.fn(),
  eventConfig: {
    confirmation: { enabled: true, sound: 'chime' },
    receive: { enabled: true, sound: 'chime' },
    send: { enabled: false, sound: 'none' },
  } as Record<string, { enabled: boolean; sound: string }>,
}));

vi.mock('../../../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockState.user,
    updatePreferences: mockState.updatePreferences,
  }),
}));

vi.mock('../../../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playSound: mockState.playSound,
    soundPresets: [
      { id: 'none', name: 'None' },
      { id: 'chime', name: 'Chime' },
      { id: 'bell', name: 'Bell' },
    ],
    soundEvents: [
      { id: 'confirmation', name: 'Confirmation', description: 'Transaction confirmed' },
      { id: 'receive', name: 'Receive', description: 'Bitcoin received' },
      { id: 'send', name: 'Send', description: 'Bitcoin sent' },
    ],
    getEventConfig: (eventId: 'confirmation' | 'receive' | 'send') => mockState.getEventConfig(eventId),
  }),
}));

describe('NotificationSoundSettings branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.updatePreferences.mockResolvedValue({});
    mockState.user = {
      id: 'user-1',
      preferences: {
        notificationSounds: {
          enabled: true,
          volume: 50,
          confirmation: { enabled: true, sound: 'chime' },
          receive: { enabled: true, sound: 'chime' },
          send: { enabled: false, sound: 'none' },
        },
      },
    };
    mockState.eventConfig = {
      confirmation: { enabled: true, sound: 'chime' },
      receive: { enabled: true, sound: 'chime' },
      send: { enabled: false, sound: 'none' },
    };
    mockState.getEventConfig.mockImplementation((eventId: string) => mockState.eventConfig[eventId]);
  });

  it('covers default preference fallback and "none" preview guards', async () => {
    const user = userEvent.setup();
    mockState.user = {
      id: 'user-1',
      preferences: {},
    };
    mockState.eventConfig = {
      confirmation: { enabled: true, sound: 'none' },
      receive: { enabled: true, sound: 'chime' },
      send: { enabled: true, sound: 'none' },
    };
    mockState.getEventConfig.mockImplementation((eventId: string) => mockState.eventConfig[eventId]);

    render(<NotificationSoundSettings />);

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('50');

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1], 'none');
    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
        notificationSounds: expect.objectContaining({
          receive: expect.objectContaining({ sound: 'none' }),
        }),
      }));
    });
    expect(mockState.playSound).not.toHaveBeenCalled();

    const testButtons = screen.getAllByTitle('Test sound');
    const reactPropsKey = Object.keys(testButtons[0]).find(key => key.startsWith('__reactProps$'));
    const reactOnClick = reactPropsKey
      ? (testButtons[0] as any)[reactPropsKey]?.onClick
      : undefined;
    expect(typeof reactOnClick).toBe('function');
    reactOnClick?.({} as React.MouseEvent<HTMLButtonElement>);
    expect(mockState.playSound).not.toHaveBeenCalled();
  });

  it('covers disabled-state class branches and volume fallback when volume is unset', () => {
    mockState.user = {
      id: 'user-1',
      preferences: {
        notificationSounds: {
          enabled: false,
          volume: undefined,
          confirmation: { enabled: true, sound: 'chime' },
          receive: { enabled: true, sound: 'bell' },
          send: { enabled: false, sound: 'none' },
        },
      },
    };
    mockState.eventConfig = {
      confirmation: { enabled: true, sound: 'chime' },
      receive: { enabled: true, sound: 'bell' },
      send: { enabled: false, sound: 'none' },
    };
    mockState.getEventConfig.mockImplementation((eventId: string) => mockState.eventConfig[eventId]);

    const { container } = render(<NotificationSoundSettings />);

    const enableLabel = screen.getByText('Enable Sounds');
    const masterToggle = enableLabel.closest('div')?.parentElement?.querySelector('button') as HTMLButtonElement;
    expect(masterToggle.className).toContain('bg-sanctuary-300');
    expect(masterToggle.querySelector('span')?.className).toContain('translate-x-1');

    const eventSection = screen.getByText('Event Sounds').parentElement as HTMLElement;
    expect(eventSection.className).toContain('opacity-50');

    const confirmationRow = screen.getByText('Confirmation').closest('div[class*="surface-muted"]') as HTMLElement;
    const rowToggle = confirmationRow.querySelector('button') as HTMLButtonElement;
    expect(rowToggle.className).toContain('cursor-not-allowed');

    const volumeLabelRow = screen.getByText('Volume').closest('div')?.parentElement as HTMLElement;
    expect(volumeLabelRow.className).toContain('opacity-50');
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('50');

    expect(container.textContent).toContain('Notification Sounds');
  });

  it('covers sound preview branches for non-none selections and test button', async () => {
    const user = userEvent.setup();
    mockState.user = {
      id: 'user-1',
      preferences: {
        notificationSounds: {
          enabled: true,
          volume: 65,
          confirmation: { enabled: true, sound: 'chime' },
          receive: { enabled: true, sound: 'chime' },
          send: { enabled: false, sound: 'none' },
        },
      },
    };
    mockState.eventConfig = {
      confirmation: { enabled: true, sound: 'chime' },
      receive: { enabled: true, sound: 'chime' },
      send: { enabled: false, sound: 'none' },
    };
    mockState.getEventConfig.mockImplementation((eventId: string) => mockState.eventConfig[eventId]);

    render(<NotificationSoundSettings />);

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'bell');
    expect(mockState.playSound).toHaveBeenCalledWith('bell', 65);

    const testButtons = screen.getAllByTitle('Test sound');
    await user.click(testButtons[0]);
    expect(mockState.playSound).toHaveBeenCalledWith('chime', 65);
  });

  it('covers per-event toggle callback and payload update', async () => {
    const user = userEvent.setup();
    render(<NotificationSoundSettings />);

    const confirmationRow = screen.getByText('Confirmation').closest('div[class*="surface-muted"]') as HTMLElement;
    const eventToggle = confirmationRow.querySelector('button') as HTMLButtonElement;
    await user.click(eventToggle);

    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
        notificationSounds: expect.objectContaining({
          confirmation: expect.objectContaining({
            enabled: false,
            sound: 'chime',
          }),
        }),
      }));
    });
  });
});
