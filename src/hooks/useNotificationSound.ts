import { useCallback, useRef } from 'react';
import { useUser } from '../contexts/UserContext';
import type { SoundType, EventSoundConfig } from '../types';
import { createLogger } from '../utils/logger';
import { SOUND_PRESETS } from './soundPresets';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const log = createLogger('NotificationSound');

// Event types that can have custom sounds
export type SoundEvent = 'confirmation' | 'receive' | 'send';

// Default sounds for each event
const DEFAULT_EVENT_SOUNDS: Record<SoundEvent, EventSoundConfig> = {
  confirmation: { enabled: true, sound: 'chime' },
  receive: { enabled: true, sound: 'coin' },
  send: { enabled: true, sound: 'success' },
};

// Event display info for settings UI
export const SOUND_EVENTS: Array<{
  id: SoundEvent;
  name: string;
  description: string;
}> = [
  { id: 'confirmation', name: 'First Confirmation', description: 'When a transaction gets its first confirmation' },
  { id: 'receive', name: 'Receive', description: 'When Bitcoin is received' },
  { id: 'send', name: 'Send', description: 'When a transaction is broadcast' },
];

/**
 * Get all available sound presets for the settings UI
 */
export function getSoundPresets(): Array<{ id: SoundType; name: string; description: string }> {
  const presets = Object.entries(SOUND_PRESETS).map(([id, preset]) => ({
    id: id as SoundType,
    name: preset.name,
    description: preset.description,
  }));
  // Add 'none' option
  presets.push({ id: 'none', name: 'None', description: 'No sound' });
  return presets;
}

/**
 * Hook for playing notification sounds
 * Uses Web Audio API to generate pleasant sounds
 */
export function useNotificationSound() {
  const { user } = useUser();
  const audioContextRef = useRef<AudioContext | null>(null);

  // Get or create AudioContext (lazy initialization)
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext!)();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Play a specific sound type
   */
  const playSound = useCallback((soundType: SoundType, volumeOverride?: number) => {
    if (soundType === 'none') return;

    try {
      const ctx = getAudioContext();
      const volume = (volumeOverride ?? 50) / 100;
      const preset = SOUND_PRESETS[soundType];

      if (preset) {
        preset.play(ctx, volume);
      }
    } catch (error) {
      log.warn('Failed to play notification sound', { error });
    }
  }, [getAudioContext]);

  /**
   * Get the event sound configuration with fallbacks
   */
  const getEventConfig = useCallback((event: SoundEvent): EventSoundConfig => {
    const prefs = user?.preferences?.notificationSounds;
    if (!prefs?.enabled) {
      return { enabled: false, sound: 'none' };
    }

    // Check for new per-event config
    const eventConfig = prefs[event];
    if (eventConfig) {
      return eventConfig;
    }

    // Fallback to legacy config for confirmation
    if (event === 'confirmation' && prefs.confirmationChime !== undefined) {
      return {
        enabled: prefs.confirmationChime,
        sound: prefs.soundType || 'chime',
      };
    }

    // Use defaults
    return DEFAULT_EVENT_SOUNDS[event];
  }, [user?.preferences?.notificationSounds]);

  /**
   * Play sound for a specific event
   */
  const playEventSound = useCallback((event: SoundEvent) => {
    const prefs = user?.preferences?.notificationSounds;
    if (!prefs?.enabled) return;

    const config = getEventConfig(event);
    if (config.enabled && config.sound !== 'none') {
      const volume = prefs.volume ?? 50;
      playSound(config.sound, volume);
    }
  }, [user?.preferences?.notificationSounds, getEventConfig, playSound]);

  /**
   * Play the configured confirmation chime (legacy method for backwards compatibility)
   */
  const playConfirmationChime = useCallback(() => {
    playEventSound('confirmation');
  }, [playEventSound]);

  /**
   * Check if notification sounds are enabled
   */
  const isSoundEnabled = useCallback(() => {
    const prefs = user?.preferences?.notificationSounds;
    return prefs?.enabled ?? false;
  }, [user?.preferences?.notificationSounds]);

  return {
    playConfirmationChime,
    playEventSound,
    playSound,
    isSoundEnabled,
    getEventConfig,
    soundPresets: getSoundPresets(),
    soundEvents: SOUND_EVENTS,
  };
}
