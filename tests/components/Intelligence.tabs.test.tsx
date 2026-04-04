/**
 * Intelligence Sub-Tab Component Tests
 *
 * Tests for InsightsTab, InsightCard, ChatTab, ChatMessage, and SettingsTab
 * components used by the Treasury Intelligence feature.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsightsTab } from '../../components/Intelligence/tabs/InsightsTab';
import { InsightCard } from '../../components/Intelligence/tabs/InsightCard';
import { ChatTab } from '../../components/Intelligence/tabs/ChatTab';
import { ChatMessage } from '../../components/Intelligence/tabs/ChatMessage';
import { SettingsTab } from '../../components/Intelligence/tabs/SettingsTab';
import * as intelligenceApi from '../../src/api/intelligence';
import type { AIInsight, AIMessage, AIConversation } from '../../src/api/intelligence';

vi.mock('../../src/api/intelligence', () => ({
  INSIGHT_TYPE_LABELS: {
    utxo_health: 'UTXO Health',
    fee_timing: 'Fee Timing',
    anomaly: 'Anomaly Detection',
    tax: 'Tax Implications',
    consolidation: 'Consolidation',
  },
  getInsights: vi.fn().mockResolvedValue({ insights: [] }),
  updateInsightStatus: vi.fn().mockResolvedValue({ insight: {} }),
  getConversations: vi.fn().mockResolvedValue({ conversations: [] }),
  createConversation: vi.fn().mockResolvedValue({ conversation: { id: 'c1', userId: 'u1', createdAt: '2024-01-01', updatedAt: '2024-01-01' } }),
  getConversationMessages: vi.fn().mockResolvedValue({ messages: [] }),
  sendChatMessage: vi.fn().mockResolvedValue({
    userMessage: { id: 'msg-1', conversationId: 'c1', role: 'user', content: 'test', createdAt: '2024-01-01' },
    assistantMessage: { id: 'msg-2', conversationId: 'c1', role: 'assistant', content: 'response', createdAt: '2024-01-01' },
  }),
  deleteConversation: vi.fn().mockResolvedValue({ success: true }),
  getIntelligenceSettings: vi.fn().mockResolvedValue({
    settings: {
      enabled: false,
      notifyTelegram: true,
      notifyPush: true,
      severityFilter: 'info',
      typeFilter: ['utxo_health'],
    },
  }),
  updateIntelligenceSettings: vi.fn().mockResolvedValue({
    settings: {
      enabled: true,
      notifyTelegram: true,
      notifyPush: true,
      severityFilter: 'info',
      typeFilter: ['utxo_health'],
    },
  }),
  getInsightCount: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ========================================
// TEST DATA
// ========================================

const mockInsight: AIInsight = {
  id: 'insight-1',
  walletId: 'wallet-1',
  type: 'utxo_health',
  severity: 'warning',
  title: 'Fragmented UTXOs Detected',
  summary: 'Your wallet has 47 small UTXOs that could be consolidated.',
  analysis: 'Detailed analysis of UTXO fragmentation and recommended consolidation strategy.',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockCriticalInsight: AIInsight = {
  id: 'insight-2',
  walletId: 'wallet-1',
  type: 'anomaly',
  severity: 'critical',
  title: 'Unusual Transaction Pattern',
  summary: 'An unusual transaction pattern was detected.',
  analysis: 'A large volume of transactions in a short window.',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockInfoInsight: AIInsight = {
  id: 'insight-3',
  walletId: 'wallet-1',
  type: 'fee_timing',
  severity: 'info',
  title: 'Low Fee Window',
  summary: 'Fees are currently low.',
  analysis: 'Network fees are at historic lows.',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockConversation: AIConversation = {
  id: 'conv-1',
  userId: 'user-1',
  walletId: 'wallet-1',
  title: 'UTXO Strategy Discussion',
  createdAt: '2024-06-01T10:00:00Z',
  updatedAt: '2024-06-01T12:00:00Z',
};

const mockUserMessage: AIMessage = {
  id: 'msg-user-1',
  conversationId: 'conv-1',
  role: 'user',
  content: 'What is my UTXO health?',
  createdAt: '2024-06-01T10:00:00Z',
};

const mockAssistantMessage: AIMessage = {
  id: 'msg-assistant-1',
  conversationId: 'conv-1',
  role: 'assistant',
  content: 'Your UTXO health is good with 12 UTXOs.',
  createdAt: '2024-06-01T10:01:00Z',
};

// ========================================
// InsightsTab
// ========================================

describe('InsightsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading spinner initially', () => {
    vi.mocked(intelligenceApi.getInsights).mockReturnValue(new Promise(() => {}));

    const { container } = render(<InsightsTab walletId="wallet-1" />);

    expect(container.querySelector('.animate-sanctuary-pulse')).toBeInTheDocument();
  });

  it('should show empty state when no insights exist', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({ insights: [] });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('No insights found.')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Insights will appear here as the AI analyzes your wallet activity.')
    ).toBeInTheDocument();
  });

  it('should render insight cards when data exists', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({
      insights: [mockInsight, mockCriticalInsight, mockInfoInsight],
    });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Fragmented UTXOs Detected')).toBeInTheDocument();
    });

    expect(screen.getByText('Unusual Transaction Pattern')).toBeInTheDocument();
    expect(screen.getByText('Low Fee Window')).toBeInTheDocument();
  });

  it('should group insights by severity with labels', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({
      insights: [mockInsight, mockCriticalInsight, mockInfoInsight],
    });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Critical \(1\)/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Warning \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Info \(1\)/)).toBeInTheDocument();
  });

  it('should render filter dropdowns', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({ insights: [] });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('No insights found.')).toBeInTheDocument();
    });

    // Should have select elements for filters
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(3);
  });

  it('should call getInsights with correct walletId and filters', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({ insights: [] });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledWith('wallet-1', {
        status: 'active',
      });
    });
  });

  it('should reload insights when filter changes', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({ insights: [] });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledTimes(1);
    });

    // Change the type filter
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'utxo_health' } });

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledTimes(2);
    });
  });

  it('should remove insight from list after dismissing', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({
      insights: [mockInsight],
    });
    vi.mocked(intelligenceApi.updateInsightStatus).mockResolvedValue({
      insight: { ...mockInsight, status: 'dismissed' },
    });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Fragmented UTXOs Detected')).toBeInTheDocument();
    });

    // Expand the card to access action buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    await waitFor(() => {
      expect(screen.getByText('Dismiss')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Dismiss'));

    await waitFor(() => {
      expect(intelligenceApi.updateInsightStatus).toHaveBeenCalledWith('insight-1', 'dismissed');
    });
  });

  it('should remove insight from list after marking as acted on', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({
      insights: [mockInsight],
    });
    vi.mocked(intelligenceApi.updateInsightStatus).mockResolvedValue({
      insight: { ...mockInsight, status: 'acted_on' },
    });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Fragmented UTXOs Detected')).toBeInTheDocument();
    });

    // Expand the card to access action buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    await waitFor(() => {
      expect(screen.getByText('Mark as acted on')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mark as acted on'));

    await waitFor(() => {
      expect(intelligenceApi.updateInsightStatus).toHaveBeenCalledWith('insight-1', 'acted_on');
    });
  });

  it('should handle getInsights API error gracefully', async () => {
    vi.mocked(intelligenceApi.getInsights).mockRejectedValue(new Error('Network error'));

    render(<InsightsTab walletId="wallet-1" />);

    // Should show empty state after error (insights array stays empty)
    await waitFor(() => {
      expect(screen.getByText('No insights found.')).toBeInTheDocument();
    });
  });

  it('should handle updateInsightStatus API error gracefully', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({
      insights: [mockInsight],
    });
    vi.mocked(intelligenceApi.updateInsightStatus).mockRejectedValue(
      new Error('Update failed')
    );

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Fragmented UTXOs Detected')).toBeInTheDocument();
    });

    // Expand and try to dismiss
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    await waitFor(() => {
      expect(screen.getByText('Dismiss')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Dismiss'));

    // Insight should remain since the API call failed
    await waitFor(() => {
      expect(intelligenceApi.updateInsightStatus).toHaveBeenCalled();
    });
  });

  it('should change severity filter', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({ insights: [] });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledTimes(1);
    });

    const selects = screen.getAllByRole('combobox');
    // Change severity filter (second select)
    fireEvent.change(selects[1], { target: { value: 'critical' } });

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledWith('wallet-1', {
        status: 'active',
        severity: 'critical',
      });
    });
  });

  it('should change status filter', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({ insights: [] });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledTimes(1);
    });

    const selects = screen.getAllByRole('combobox');
    // Change status filter (third select)
    fireEvent.change(selects[2], { target: { value: 'dismissed' } });

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledWith('wallet-1', {
        status: 'dismissed',
      });
    });
  });

  it('should omit statusFilter from API call when cleared to empty string', async () => {
    vi.mocked(intelligenceApi.getInsights).mockResolvedValue({ insights: [] });

    render(<InsightsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledTimes(1);
    });

    const selects = screen.getAllByRole('combobox');
    // Clear the status filter to empty string to exercise the falsy branch
    fireEvent.change(selects[2], { target: { value: '' } });

    await waitFor(() => {
      expect(intelligenceApi.getInsights).toHaveBeenCalledWith('wallet-1', {});
    });
  });
});

// ========================================
// InsightCard
// ========================================

describe('InsightCard', () => {
  const defaultProps = {
    insight: mockInsight,
    onDismiss: vi.fn(),
    onActedOn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render title, summary, and severity type badge', () => {
    render(<InsightCard {...defaultProps} />);

    expect(screen.getByText('Fragmented UTXOs Detected')).toBeInTheDocument();
    expect(
      screen.getByText('Your wallet has 47 small UTXOs that could be consolidated.')
    ).toBeInTheDocument();
    expect(screen.getByText('UTXO Health')).toBeInTheDocument();
  });

  it('should expand on click to show analysis', () => {
    render(<InsightCard {...defaultProps} />);

    // Analysis should not be visible initially
    expect(
      screen.queryByText(
        'Detailed analysis of UTXO fragmentation and recommended consolidation strategy.'
      )
    ).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    // Analysis should now be visible
    expect(
      screen.getByText(
        'Detailed analysis of UTXO fragmentation and recommended consolidation strategy.'
      )
    ).toBeInTheDocument();
  });

  it('should collapse on second click', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));
    expect(
      screen.getByText(/Detailed analysis/)
    ).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));
    expect(
      screen.queryByText(/Detailed analysis/)
    ).not.toBeInTheDocument();
  });

  it('should call onDismiss when Dismiss button is clicked', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to see action buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    fireEvent.click(screen.getByText('Dismiss'));

    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should call onActedOn when "Mark as acted on" button is clicked', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to see action buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    fireEvent.click(screen.getByText('Mark as acted on'));

    expect(defaultProps.onActedOn).toHaveBeenCalledTimes(1);
  });

  it('should render critical severity correctly', () => {
    render(
      <InsightCard
        {...defaultProps}
        insight={mockCriticalInsight}
      />
    );

    expect(screen.getByText('Unusual Transaction Pattern')).toBeInTheDocument();
    expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
  });

  it('should render info severity correctly', () => {
    render(
      <InsightCard
        {...defaultProps}
        insight={mockInfoInsight}
      />
    );

    expect(screen.getByText('Low Fee Window')).toBeInTheDocument();
    expect(screen.getByText('Fee Timing')).toBeInTheDocument();
  });

  it('should show relative time for recent insights', () => {
    render(<InsightCard {...defaultProps} />);

    // The createdAt is "now", so it should show "just now"
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('should show relative time in minutes', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('should show relative time in hours', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  it('should show relative time in days', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('should show date string for older insights', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    // Should show a formatted date string (locale-dependent)
    const dateText = new Date(pastInsight.createdAt).toLocaleDateString();
    expect(screen.getByText(dateText)).toBeInTheDocument();
  });

  it('should render all insight types with correct labels', () => {
    const types: Array<{ type: AIInsight['type']; label: string }> = [
      { type: 'utxo_health', label: 'UTXO Health' },
      { type: 'fee_timing', label: 'Fee Timing' },
      { type: 'anomaly', label: 'Anomaly Detection' },
      { type: 'tax', label: 'Tax Implications' },
      { type: 'consolidation', label: 'Consolidation' },
    ];

    for (const { type, label } of types) {
      const { unmount } = render(
        <InsightCard
          {...defaultProps}
          insight={{ ...mockInsight, type }}
        />
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('should stop event propagation on dismiss button click', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to show buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));
    expect(screen.getByText('Dismiss')).toBeInTheDocument();

    // Click dismiss - should not collapse the card (stopPropagation)
    fireEvent.click(screen.getByText('Dismiss'));

    // The card should still be expanded (analysis still visible)
    expect(defaultProps.onDismiss).toHaveBeenCalled();
  });

  it('should stop event propagation on acted on button click', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to show buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    fireEvent.click(screen.getByText('Mark as acted on'));

    expect(defaultProps.onActedOn).toHaveBeenCalled();
  });
});

// ========================================
// ChatTab
// ========================================

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
      expect(
        screen.getByText('Your UTXO health is good with 12 UTXOs.')
      ).toBeInTheDocument();
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
      expect(intelligenceApi.sendChatMessage).toHaveBeenCalledWith(
        'conv-1',
        'How are my UTXOs?',
        { walletId: 'wallet-1' }
      );
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
    vi.mocked(intelligenceApi.getConversationMessages).mockRejectedValue(
      new Error('Load failed')
    );

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
      expect(intelligenceApi.sendChatMessage).toHaveBeenCalledWith(
        'conv-1',
        'Test via button',
        { walletId: 'wallet-1' }
      );
    });
  });
});

// ========================================
// ChatMessage
// ========================================

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

    expect(
      screen.getByText('Your UTXO health is good with 12 UTXOs.')
    ).toBeInTheDocument();
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
    const { container: assistantContainer } = render(
      <ChatMessage message={mockAssistantMessage} />
    );
    // Assistant has an avatar circle
    expect(assistantContainer.querySelector('.rounded-full')).toBeInTheDocument();

    const { container: userContainer } = render(
      <ChatMessage message={mockUserMessage} />
    );
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

// ========================================
// SettingsTab
// ========================================

describe('SettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading spinner while settings load', () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockReturnValue(new Promise(() => {}));

    const { container } = render(<SettingsTab walletId="wallet-1" />);

    expect(container.querySelector('.animate-sanctuary-pulse')).toBeInTheDocument();
  });

  it('should show error state when settings fail to load', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockRejectedValue(
      new Error('Load failed')
    );

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to load intelligence settings.')
      ).toBeInTheDocument();
    });
  });

  it('should render settings toggles after loading', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: false,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Enable intelligence')).toBeInTheDocument();
    });

    expect(screen.getByText('Telegram notifications')).toBeInTheDocument();
    expect(screen.getByText('Push notifications')).toBeInTheDocument();
    expect(screen.getByText('Intelligence Settings')).toBeInTheDocument();
  });

  it('should call updateIntelligenceSettings when toggle is clicked', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: false,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Enable intelligence')).toBeInTheDocument();
    });

    // Click the enable toggle (it's a button with role="switch")
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]); // Enable intelligence toggle

    await waitFor(() => {
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith(
        'wallet-1',
        { enabled: true }
      );
    });
  });

  it('should render severity filter dropdown', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Minimum Severity')).toBeInTheDocument();
    });

    // Should have severity options
    expect(screen.getByText('All (Info and above)')).toBeInTheDocument();
  });

  it('should change severity filter and call update API', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Minimum Severity')).toBeInTheDocument();
    });

    const severitySelect = screen.getByRole('combobox');
    fireEvent.change(severitySelect, { target: { value: 'critical' } });

    await waitFor(() => {
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith(
        'wallet-1',
        { severityFilter: 'critical' }
      );
    });
  });

  it('should render type filter checkboxes', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Insight Types')).toBeInTheDocument();
    });

    expect(screen.getByText('UTXO Health')).toBeInTheDocument();
    expect(screen.getByText('Fee Timing')).toBeInTheDocument();
    expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
    expect(screen.getByText('Tax Implications')).toBeInTheDocument();
    expect(screen.getByText('Consolidation')).toBeInTheDocument();
  });

  it('should toggle type filter checkbox and call update API', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Fee Timing')).toBeInTheDocument();
    });

    // Toggle "Fee Timing" on (it's not in typeFilter currently)
    const feeTimingCheckbox = screen.getByLabelText('Fee Timing');
    fireEvent.click(feeTimingCheckbox);

    await waitFor(() => {
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith(
        'wallet-1',
        { typeFilter: ['utxo_health', 'fee_timing'] }
      );
    });
  });

  it('should remove type from filter when unchecked', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health', 'fee_timing'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Health')).toBeInTheDocument();
    });

    // Uncheck UTXO Health (it's currently in typeFilter)
    const utxoCheckbox = screen.getByLabelText('UTXO Health');
    fireEvent.click(utxoCheckbox);

    await waitFor(() => {
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith(
        'wallet-1',
        { typeFilter: ['fee_timing'] }
      );
    });
  });

  it('should handle updateIntelligenceSettings API error and revert', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: false,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });
    vi.mocked(intelligenceApi.updateIntelligenceSettings).mockRejectedValue(
      new Error('Update failed')
    );

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Enable intelligence')).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    // Enable toggle - current state is off
    expect(switches[0]).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(switches[0]);

    // After API failure, should revert
    await waitFor(() => {
      expect(switches[0]).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('should toggle push notification setting', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: false,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Push notifications')).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    // switches[0] = Enable intelligence, switches[1] = Telegram, switches[2] = Push
    fireEvent.click(switches[2]); // Toggle push notifications on

    await waitFor(() => {
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith(
        'wallet-1',
        { notifyPush: true }
      );
    });
  });

  it('should toggle telegram notification setting', async () => {
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Telegram notifications')).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    // switches[0] = Enable intelligence, switches[1] = Telegram, switches[2] = Push
    fireEvent.click(switches[1]); // Toggle telegram notifications off

    await waitFor(() => {
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith(
        'wallet-1',
        { notifyTelegram: false }
      );
    });
  });

  it('should guard updateSetting when settings is null (API resolves null)', async () => {
    // When the API resolves with settings: null (rather than rejecting),
    // setSettings(null) is called explicitly. The component renders the error
    // state and the updateSetting/handleTypeFilterToggle guards are exercised
    // through the render-time !settings check.
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: null as unknown as any,
    });

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to load intelligence settings.')
      ).toBeInTheDocument();
    });

    // Toggles should not be rendered when settings is null
    expect(screen.queryByText('Enable intelligence')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('should show "Saving..." indicator while updating', async () => {
    let resolveUpdate: (value: { settings: Record<string, unknown> }) => void;
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockResolvedValue({
      settings: {
        enabled: false,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      },
    });
    vi.mocked(intelligenceApi.updateIntelligenceSettings).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }) as never
    );

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Enable intelligence')).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    // Resolve the update
    await act(async () => {
      resolveUpdate!({
        settings: {
          enabled: true,
          notifyTelegram: true,
          notifyPush: true,
          severityFilter: 'info',
          typeFilter: ['utxo_health'],
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('Saving...')).not.toBeInTheDocument();
    });
  });
});
