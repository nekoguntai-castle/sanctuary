import './intelligenceTabsTestHarness';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsTab } from '../../../components/Intelligence/tabs/SettingsTab';
import * as intelligenceApi from '../../../src/api/intelligence';

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
    vi.mocked(intelligenceApi.getIntelligenceSettings).mockRejectedValue(new Error('Load failed'));

    render(<SettingsTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load intelligence settings.')).toBeInTheDocument();
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
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith('wallet-1', {
        enabled: true,
      });
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
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith('wallet-1', {
        severityFilter: 'critical',
      });
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
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith('wallet-1', {
        typeFilter: ['utxo_health', 'fee_timing'],
      });
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
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith('wallet-1', {
        typeFilter: ['fee_timing'],
      });
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
    vi.mocked(intelligenceApi.updateIntelligenceSettings).mockRejectedValue(new Error('Update failed'));

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
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith('wallet-1', {
        notifyPush: true,
      });
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
      expect(intelligenceApi.updateIntelligenceSettings).toHaveBeenCalledWith('wallet-1', {
        notifyTelegram: false,
      });
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
      expect(screen.getByText('Failed to load intelligence settings.')).toBeInTheDocument();
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
