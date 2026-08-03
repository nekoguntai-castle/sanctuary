import React from 'react';
import { useUser } from '../../../contexts/UserContext';
import { Volume2 } from 'lucide-react';
import { Toggle } from '../../ui/Toggle';
import { useNotificationSound } from '../../../hooks/useNotificationSound';
import type { NotificationSounds, SoundType } from '../../../types';

type SoundEventId = 'confirmation' | 'receive' | 'send';

type SoundPreferences = Omit<NotificationSounds, 'volume'> & {
  volume?: number;
  [key: string]: unknown;
};

interface SoundEventConfig {
  enabled: boolean;
  sound: string;
}

interface SoundEventDefinition {
  id: SoundEventId;
  name: string;
  description: string;
}

interface SoundPreset {
  id: string;
  name: string;
}

interface SoundEventRowProps {
  event: SoundEventDefinition;
  config: SoundEventConfig;
  soundPrefs: SoundPreferences;
  soundPresets: SoundPreset[];
  onToggle: (eventId: SoundEventId) => void;
  onSoundChange: (eventId: SoundEventId, sound: string) => void;
  onTestSound: (sound: string) => void;
}

const defaultSoundPreferences: SoundPreferences = {
  enabled: true,
  volume: 50,
};

function SoundSectionHeader() {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-3">
        <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
          <Volume2 className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Notification Sounds</h3>
      </div>
    </div>
  );
}

function MasterSoundToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable Sounds</label>
        <p className="text-sm text-sanctuary-500">Master toggle for all notification sounds</p>
      </div>
      <Toggle checked={enabled} onChange={onToggle} />
    </div>
  );
}

function EventToggle({
  enabled,
  masterEnabled,
  onClick,
}: {
  enabled: boolean;
  masterEnabled: boolean;
  onClick: () => void;
}) {
  const isActive = enabled && masterEnabled;

  return (
    <button
      onClick={onClick}
      disabled={!masterEnabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        isActive ? 'bg-success-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
      } ${!masterEnabled ? 'cursor-not-allowed' : ''}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
        isActive ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

function SoundSelector({
  value,
  disabled,
  soundPresets,
  onChange,
}: {
  value: string;
  disabled: boolean;
  soundPresets: SoundPreset[];
  onChange: (sound: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="px-2 py-1 text-xs surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {soundPresets.map((preset) => (
        <option key={preset.id} value={preset.id}>
          {preset.name}
        </option>
      ))}
    </select>
  );
}

function TestSoundButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 text-sanctuary-500 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Test sound"
    >
      <Volume2 className="w-4 h-4" />
    </button>
  );
}

function SoundEventRow({
  event,
  config,
  soundPrefs,
  soundPresets,
  onToggle,
  onSoundChange,
  onTestSound,
}: SoundEventRowProps) {
  const controlsDisabled = !soundPrefs.enabled || !config.enabled;

  return (
    <div className="flex items-center gap-3 p-3 surface-muted rounded-lg">
      <EventToggle
        enabled={config.enabled}
        masterEnabled={soundPrefs.enabled}
        onClick={() => onToggle(event.id)}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{event.name}</div>
        <div className="text-xs text-sanctuary-500 truncate">{event.description}</div>
      </div>
      <SoundSelector
        value={config.sound}
        disabled={controlsDisabled}
        soundPresets={soundPresets}
        onChange={(sound) => onSoundChange(event.id, sound)}
      />
      <TestSoundButton
        disabled={controlsDisabled || config.sound === 'none'}
        onClick={() => onTestSound(config.sound)}
      />
    </div>
  );
}

function EventSoundsSection({
  enabled,
  soundEvents,
  soundPresets,
  getEventConfig,
  soundPrefs,
  onToggle,
  onSoundChange,
  onTestSound,
}: {
  enabled: boolean;
  soundEvents: SoundEventDefinition[];
  soundPresets: SoundPreset[];
  getEventConfig: (eventId: SoundEventId) => SoundEventConfig;
  soundPrefs: SoundPreferences;
  onToggle: (eventId: SoundEventId) => void;
  onSoundChange: (eventId: SoundEventId, sound: string) => void;
  onTestSound: (sound: string) => void;
}) {
  return (
    <div className={`pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 space-y-4 ${!enabled ? 'opacity-50' : ''}`}>
      <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Event Sounds</label>
      {soundEvents.map((event) => (
        <SoundEventRow
          key={event.id}
          event={event}
          config={getEventConfig(event.id)}
          soundPrefs={soundPrefs}
          soundPresets={soundPresets}
          onToggle={onToggle}
          onSoundChange={onSoundChange}
          onTestSound={onTestSound}
        />
      ))}
    </div>
  );
}

function VolumeControl({
  enabled,
  volume,
  onChange,
}: {
  enabled: boolean;
  volume: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className={`pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 ${!enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Volume</label>
        <span className="text-sm text-sanctuary-500">{volume}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={volume}
        onChange={onChange}
        disabled={!enabled}
        className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
      />
    </div>
  );
}

const NotificationSoundSettings: React.FC = () => {
  const { user, updatePreferences } = useUser();
  const { playSound, soundPresets, soundEvents, getEventConfig } = useNotificationSound();

  const soundPrefs = (user?.preferences?.notificationSounds || defaultSoundPreferences) as SoundPreferences;
  const volume = soundPrefs.volume ?? 50;

  const handleToggleSounds = async () => {
    const newEnabled = !soundPrefs.enabled;
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        volume,
        enabled: newEnabled,
      },
    });
  };

  const handleEventToggle = async (eventId: SoundEventId) => {
    const currentConfig = getEventConfig(eventId);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        volume,
        [eventId]: {
          ...currentConfig,
          enabled: !currentConfig.enabled,
        },
      },
    });
  };

  const handleEventSoundChange = async (eventId: SoundEventId, sound: string) => {
    const currentConfig = getEventConfig(eventId);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        volume,
        [eventId]: {
          ...currentConfig,
          sound,
        },
      },
    });
    // Play preview of selected sound
    if (sound !== 'none') {
      playSound(sound as SoundType, volume);
    }
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = parseInt(e.target.value, 10);
    await updatePreferences({
      notificationSounds: {
        ...soundPrefs,
        volume: nextVolume,
      },
    });
  };

  const handleTestSound = (sound: string) => {
    if (sound !== 'none') {
      playSound(sound as SoundType, volume);
    }
  };

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <SoundSectionHeader />

      <div className="p-6 space-y-6">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          Play audio notifications for wallet events. Configure different sounds for each event type.
        </p>

        <MasterSoundToggle enabled={soundPrefs.enabled} onToggle={handleToggleSounds} />
        <EventSoundsSection
          enabled={soundPrefs.enabled}
          soundEvents={soundEvents as SoundEventDefinition[]}
          soundPresets={soundPresets}
          getEventConfig={getEventConfig}
          soundPrefs={soundPrefs}
          onToggle={handleEventToggle}
          onSoundChange={handleEventSoundChange}
          onTestSound={handleTestSound}
        />
        <VolumeControl
          enabled={soundPrefs.enabled}
          volume={volume}
          onChange={handleVolumeChange}
        />
      </div>
    </div>
  );
};

export { NotificationSoundSettings };
