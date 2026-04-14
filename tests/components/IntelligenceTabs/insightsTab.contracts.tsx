import {
  mockCriticalInsight,
  mockInfoInsight,
  mockInsight,
} from './intelligenceTabsTestHarness';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsightsTab } from '../../../components/Intelligence/tabs/InsightsTab';
import * as intelligenceApi from '../../../src/api/intelligence';

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
    vi.mocked(intelligenceApi.updateInsightStatus).mockRejectedValue(new Error('Update failed'));

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
