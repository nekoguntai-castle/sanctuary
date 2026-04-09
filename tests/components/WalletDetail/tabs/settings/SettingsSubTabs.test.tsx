import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSubTabs } from '../../../../../components/WalletDetail/tabs/settings/SettingsSubTabs';

describe('SettingsSubTabs', () => {
  it('renders all five tab buttons', () => {
    render(
      <SettingsSubTabs settingsSubTab="general" onSettingsSubTabChange={vi.fn()} />,
    );

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Autopilot')).toBeInTheDocument();
  });

  it('applies active styling to the currently selected tab', () => {
    render(
      <SettingsSubTabs settingsSubTab="devices" onSettingsSubTabChange={vi.fn()} />,
    );

    const devicesButton = screen.getByText('Devices');
    expect(devicesButton.className).toContain('bg-white');
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

    fireEvent.click(screen.getByText('Autopilot'));
    expect(onChange).toHaveBeenCalledWith('autopilot');
  });
});
