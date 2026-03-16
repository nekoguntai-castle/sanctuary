import React from 'react';
import { useUser } from '../../../contexts/UserContext';
import { Volume2 } from 'lucide-react';
import { Toggle } from '../../ui/Toggle';
import { useNotificationSound } from '../../../hooks/useNotificationSound';

const NotificationSoundSettings: React.FC = () => {
  const { user, updatePreferences } = useUser();
  const { playSound, soundPresets, soundEvents, getEventConfig } = useNotificationSound();

  const soundPrefs = user?.preferences?.notificationSounds || {
    enabled: true,
    volume: 50,
  };

  const handleToggleSounds = async () => {
    const newEnabled = !soundPrefs.enabled;
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        enabled: newEnabled,
      },
    });
  };

  const handleEventToggle = async (eventId: 'confirmation' | 'receive' | 'send') => {
    const currentConfig = getEventConfig(eventId);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        [eventId]: {
          ...currentConfig,
          enabled: !currentConfig.enabled,
        },
      },
    });
  };

  const handleEventSoundChange = async (eventId: 'confirmation' | 'receive' | 'send', sound: string) => {
    const currentConfig = getEventConfig(eventId);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        [eventId]: {
          ...currentConfig,
          sound,
        },
      },
    });
    // Play preview of selected sound
    if (sound !== 'none') {
      playSound(sound as any, soundPrefs.volume);
    }
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseInt(e.target.value, 10);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        volume,
      },
    });
  };

  const handleTestSound = (sound: string) => {
    if (sound !== 'none') {
      playSound(sound as any, soundPrefs.volume);
    }
  };

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Volume2 className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Notification Sounds</h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          Play audio notifications for wallet events. Configure different sounds for each event type.
        </p>

        {/* Master Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable Sounds</label>
            <p className="text-sm text-sanctuary-500">Master toggle for all notification sounds</p>
          </div>
          <Toggle checked={soundPrefs.enabled} onChange={handleToggleSounds} />
        </div>

        {/* Per-Event Sound Configuration */}
        <div className={`pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 space-y-4 ${!soundPrefs.enabled ? 'opacity-50' : ''}`}>
          <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Event Sounds</label>

          {soundEvents.map((event) => {
            const config = getEventConfig(event.id);
            return (
              <div key={event.id} className="flex items-center gap-3 p-3 surface-muted rounded-xl">
                {/* Event toggle */}
                <button
                  onClick={() => handleEventToggle(event.id)}
                  disabled={!soundPrefs.enabled}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    config.enabled && soundPrefs.enabled ? 'bg-success-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                  } ${!soundPrefs.enabled ? 'cursor-not-allowed' : ''}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
                    config.enabled && soundPrefs.enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>

                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{event.name}</div>
                  <div className="text-xs text-sanctuary-500 truncate">{event.description}</div>
                </div>

                {/* Sound selector */}
                <select
                  value={config.sound}
                  onChange={(e) => handleEventSoundChange(event.id, e.target.value)}
                  disabled={!soundPrefs.enabled || !config.enabled}
                  className="px-2 py-1 text-xs surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {soundPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>

                {/* Test button */}
                <button
                  onClick={() => handleTestSound(config.sound)}
                  disabled={!soundPrefs.enabled || !config.enabled || config.sound === 'none'}
                  className="p-1.5 text-sanctuary-500 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Test sound"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Volume Slider */}
        <div className={`pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 ${!soundPrefs.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Volume</label>
            <span className="text-sm text-sanctuary-500">{soundPrefs.volume ?? 50}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={soundPrefs.volume ?? 50}
            onChange={handleVolumeChange}
            disabled={!soundPrefs.enabled}
            className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
          />
        </div>
      </div>
    </div>
  );
};

export { NotificationSoundSettings };
