import {
  mockAssistantMessage,
  mockConversation,
  mockUserMessage,
} from './intelligenceTabsTestHarness';
import type { AIConversation } from './intelligenceTabsTestHarness';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTab } from '../../../components/Intelligence/tabs/ChatTab';
import * as intelligenceApi from '../../../src/api/intelligence';

describe('ChatTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading spinner while conversations load', () => {
    vi.mocked(intelligenceApi.getConversations).mockReturnValue(new Promise(() => {}));

    const { container } = render(<ChatTab walletId="wallet-1" />);

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should show empty conversation list', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    });
  });

  it('should render conversation list', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });
  });

  it('should show "New Conversation" button', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New Conversation')).toBeInTheDocument();
    });
  });

  it('should show placeholder when no conversation is selected', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Treasury Intelligence Chat')).toBeInTheDocument();
    });

    expect(screen.getByText('Select a conversation or start a new one')).toBeInTheDocument();
  });

  it('should create a new conversation when button is clicked', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });
    vi.mocked(intelligenceApi.createConversation).mockResolvedValue({
      conversation: {
        id: 'new-conv',
        userId: 'user-1',
        walletId: 'wallet-1',
        createdAt: '2024-06-01',
        updatedAt: '2024-06-01',
      },
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New Conversation')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Conversation'));

    await waitFor(() => {
      expect(intelligenceApi.createConversation).toHaveBeenCalledWith('wallet-1');
    });
  });

  it('should load messages when a conversation is selected', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({
      messages: [mockUserMessage, mockAssistantMessage],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    // Click on conversation
    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(intelligenceApi.getConversationMessages).toHaveBeenCalledWith('conv-1');
    });

    await waitFor(() => {
      expect(screen.getByText('What is my UTXO health?')).toBeInTheDocument();
      expect(screen.getByText('Your UTXO health is good with 12 UTXOs.')).toBeInTheDocument();
    });
  });

  it('should render message input area when conversation is selected', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });
  });

  it('should send a message when Enter is pressed', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'How are my UTXOs?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(intelligenceApi.sendChatMessage).toHaveBeenCalledWith('conv-1', 'How are my UTXOs?', {
        walletId: 'wallet-1',
      });
    });
  });

  it('should not send when Enter+Shift is pressed (multiline)', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(intelligenceApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it('should not send empty messages', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(intelligenceApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it('should delete a conversation', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    // Find the delete button
    const deleteButton = screen.getByTitle('Delete conversation');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(intelligenceApi.deleteConversation).toHaveBeenCalledWith('conv-1');
    });
  });

  it('should delete selected conversation and clear messages', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({
      messages: [mockUserMessage],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    // Select the conversation first
    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByText('What is my UTXO health?')).toBeInTheDocument();
    });

    // Delete the selected conversation - wait for delete button to be available
    await waitFor(() => {
      expect(screen.getByTitle('Delete conversation')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete conversation'));

    await waitFor(() => {
      expect(intelligenceApi.deleteConversation).toHaveBeenCalledWith('conv-1');
    });

    // Should show the placeholder again
    await waitFor(() => {
      expect(screen.getByText('Select a conversation or start a new one')).toBeInTheDocument();
    });
  });

  it('should show "Ask anything about your wallet" when conversation is empty', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByText('Ask anything about your wallet')).toBeInTheDocument();
    });
  });

  it('should render "New conversation" for conversations without title', async () => {
    const untitledConv: AIConversation = {
      ...mockConversation,
      id: 'conv-untitled',
      title: undefined,
    };
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [untitledConv],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New conversation')).toBeInTheDocument();
    });
  });

  it('should handle send message API failure gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });
    vi.mocked(intelligenceApi.sendChatMessage).mockRejectedValue(new Error('Send failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Input should be restored after failure
    await waitFor(() => {
      expect(textarea).toHaveValue('test message');
    });
  });

  it('should handle getConversations API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockRejectedValue(new Error('Network error'));

    render(<ChatTab walletId="wallet-1" />);

    // Should show empty conversation state
    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    });
  });

  it('should handle getConversationMessages API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockRejectedValue(new Error('Load failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    // Should not crash, empty messages shown
    await waitFor(() => {
      expect(screen.getByText('Ask anything about your wallet')).toBeInTheDocument();
    });
  });

  it('should handle createConversation API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });
    vi.mocked(intelligenceApi.createConversation).mockRejectedValue(new Error('Create failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New Conversation')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Conversation'));

    // Should not crash
    await waitFor(() => {
      expect(intelligenceApi.createConversation).toHaveBeenCalled();
    });
  });

  it('should handle deleteConversation API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.deleteConversation).mockRejectedValue(new Error('Delete failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    const deleteButton = screen.getByTitle('Delete conversation');
    fireEvent.click(deleteButton);

    // Should not crash
    await waitFor(() => {
      expect(intelligenceApi.deleteConversation).toHaveBeenCalled();
    });
  });

  it('should send message via send button click', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'Test via button' } });

    // Find the send button (the one with the Send icon, which is the button next to the textarea)
    const buttons = screen.getAllByRole('button');
    // The send button is the last button in the input area
    const sendButton = buttons[buttons.length - 1];
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(intelligenceApi.sendChatMessage).toHaveBeenCalledWith('conv-1', 'Test via button', {
        walletId: 'wallet-1',
      });
    });
  });
});
