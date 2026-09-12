/**
 * Split out from SoundSection.branches.test.tsx: adding this case there
 * pushed that file's describe-block CCN past the lizard baseline. SoundSection
 * has no per-form error affordance (unlike TelegramSection), so a failed save
 * is only observable via a warn-level log and must not show any success
 * signal — see the contract in useUserPreferenceMutation.ts.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationSoundSettings } from '../../../../src/components/Settings/sections/SoundSection';

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
  } as unknown,
  updatePreferences: vi.fn(),
  playSound: vi.fn(),
  getEventConfig: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../src/contexts/UserContext', () => ({
  useUser: () => ({
    user: mockState.user,
    updatePreferences: mockState.updatePreferences,
  }),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/hooks/useNotificationSound', () => ({
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

describe('NotificationSoundSettings save result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getEventConfig.mockImplementation((eventId: string) => ({
      confirmation: { enabled: true, sound: 'chime' },
      receive: { enabled: true, sound: 'chime' },
      send: { enabled: false, sound: 'none' },
    }[eventId]));
  });

  it('shows no success signal and logs a warning when a save fails', async () => {
    const user = userEvent.setup();
    mockState.updatePreferences.mockResolvedValueOnce({ ok: false, error: 'save failed' });
    render(<NotificationSoundSettings />);

    const enableLabel = screen.getByText('Enable Sounds');
    const masterToggle = enableLabel.closest('div')?.parentElement?.querySelector('button') as HTMLButtonElement;
    await user.click(masterToggle);

    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledTimes(1);
    });
    // SoundSection has no per-form error affordance; a failed save is only
    // observable via a warn-level log, and produces no success indicator.
    await waitFor(() => {
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to save sound master toggle',
        { error: 'save failed' },
      );
    });
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});
