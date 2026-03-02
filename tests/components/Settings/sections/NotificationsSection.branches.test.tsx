import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationsTab } from '../../../../components/Settings/sections/NotificationsSection';

vi.mock('../../../../components/Settings/sections/SoundSection', () => ({
  NotificationSoundSettings: () => <div data-testid="sound-content">Sound Content</div>,
}));

vi.mock('../../../../components/Settings/sections/TelegramSection', () => ({
  TelegramSettings: () => <div data-testid="telegram-content">Telegram Content</div>,
}));

describe('NotificationsSection branch coverage', () => {
  it('covers sub-tab switching between telegram and sound', async () => {
    const user = userEvent.setup();
    render(<NotificationsTab />);

    expect(screen.getByTestId('sound-content')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /telegram/i }));
    expect(screen.getByTestId('telegram-content')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /sound/i }));
    expect(screen.getByTestId('sound-content')).toBeInTheDocument();
  });
});
