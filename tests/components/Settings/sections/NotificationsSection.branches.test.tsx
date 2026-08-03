import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { NotificationsTab } from '../../../../src/components/Settings/sections/NotificationsSection';

vi.mock('../../../../src/components/Settings/sections/SoundSection', () => ({
  NotificationSoundSettings: () => <div data-testid="sound-content">Sound Content</div>,
}));

vi.mock('../../../../src/components/Settings/sections/TelegramSection', () => ({
  TelegramSettings: () => <div data-testid="telegram-content">Telegram Content</div>,
}));

describe('NotificationsSection branch coverage', () => {
  it('covers sub-tab switching between telegram and sound', async () => {
    const user = userEvent.setup();
    render(<NotificationsTab />);

    expect(screen.getByTestId('sound-content')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /telegram/i }));
    expect(screen.getByTestId('telegram-content')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /sound/i }));
    expect(screen.getByTestId('sound-content')).toBeInTheDocument();
  });
});
