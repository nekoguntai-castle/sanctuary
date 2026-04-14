import {
  mockAssistantMessage,
  mockUserMessage,
} from './intelligenceTabsTestHarness';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from '../../../components/Intelligence/tabs/ChatMessage';

describe('ChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render user message content', () => {
    render(<ChatMessage message={mockUserMessage} />);

    expect(screen.getByText('What is my UTXO health?')).toBeInTheDocument();
  });

  it('should render assistant message content', () => {
    render(<ChatMessage message={mockAssistantMessage} />);

    expect(screen.getByText('Your UTXO health is good with 12 UTXOs.')).toBeInTheDocument();
  });

  it('should align user messages to the right', () => {
    const { container } = render(<ChatMessage message={mockUserMessage} />);

    const outerDiv = container.firstElementChild;
    expect(outerDiv).toHaveClass('justify-end');
  });

  it('should align assistant messages to the left', () => {
    const { container } = render(<ChatMessage message={mockAssistantMessage} />);

    const outerDiv = container.firstElementChild;
    expect(outerDiv).toHaveClass('justify-start');
  });

  it('should show avatar icon for assistant messages only', () => {
    const { container: assistantContainer } = render(<ChatMessage message={mockAssistantMessage} />);
    // Assistant has an avatar circle
    expect(assistantContainer.querySelector('.rounded-full')).toBeInTheDocument();

    const { container: userContainer } = render(<ChatMessage message={mockUserMessage} />);
    // User does not have the avatar circle (the rounded-full may still exist for the bubble)
    // Check for the avatar wrapper specifically
    const avatarWrappers = userContainer.querySelectorAll('.rounded-full');
    // The user bubble has rounded-xl, not rounded-full for the avatar
    const hasAvatarCircle = Array.from(avatarWrappers).some(
      (el) => el.classList.contains('h-6') && el.classList.contains('w-6')
    );
    expect(hasAvatarCircle).toBe(false);
  });

  it('should display formatted time', () => {
    render(<ChatMessage message={mockUserMessage} />);

    // The time is formatted with toLocaleTimeString
    const time = new Date('2024-06-01T10:00:00Z').toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByText(time)).toBeInTheDocument();
  });

  it('should apply user message styling', () => {
    render(<ChatMessage message={mockUserMessage} />);

    const bubble = screen.getByText('What is my UTXO health?').closest('.rounded-xl');
    expect(bubble).toHaveClass('bg-primary-600');
  });

  it('should apply assistant message styling', () => {
    render(<ChatMessage message={mockAssistantMessage} />);

    const bubble = screen
      .getByText('Your UTXO health is good with 12 UTXOs.')
      .closest('.rounded-xl');
    expect(bubble).toHaveClass('bg-sanctuary-100');
  });
});
