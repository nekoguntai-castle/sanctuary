import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSubTabs } from '../../../../../components/WalletDetail/tabs/settings/SettingsSubTabs';

describe('SettingsSubTabs', () => {
  it('renders all settings tab buttons', () => {
    render(
      <SettingsSubTabs settingsSubTab="general" onSettingsSubTabChange={vi.fn()} />,
    );

    expect(screen.getByRole('tablist', { name: 'Wallet settings sections' })).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Autopilot')).toBeInTheDocument();
  });

  it('applies active styling to the currently selected tab', () => {
    render(
      <SettingsSubTabs settingsSubTab="devices" onSettingsSubTabChange={vi.fn()} />,
    );

    const devicesButton = screen.getByText('Devices');
    expect(devicesButton.className).toContain('bg-white');
    expect(screen.getByRole('tab', { name: 'Devices' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('calls onSettingsSubTabChange when a tab is clicked', () => {
    const onChange = vi.fn();
    render(
      <SettingsSubTabs settingsSubTab="general" onSettingsSubTabChange={onChange} />,
    );

    fireEvent.click(screen.getByText('Advanced'));
    expect(onChange).toHaveBeenCalledWith('advanced');
  });

  it('calls handler with correct key for each tab', () => {
    const onChange = vi.fn();
    render(
      <SettingsSubTabs settingsSubTab="general" onSettingsSubTabChange={onChange} />,
    );

    fireEvent.click(screen.getByText('Notifications'));
    expect(onChange).toHaveBeenCalledWith('notifications');

    fireEvent.click(screen.getByText('Webhooks'));
    expect(onChange).toHaveBeenCalledWith('webhooks');

    fireEvent.click(screen.getByText('Autopilot'));
    expect(onChange).toHaveBeenCalledWith('autopilot');
  });

  it('supports keyboard navigation between tabs', () => {
    const onChange = vi.fn();
    render(
      <SettingsSubTabs settingsSubTab="general" onSettingsSubTabChange={onChange} />,
    );

    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Wallet settings sections' }), {
      key: 'End',
    });

    expect(onChange).toHaveBeenCalledWith('autopilot');
  });
});
