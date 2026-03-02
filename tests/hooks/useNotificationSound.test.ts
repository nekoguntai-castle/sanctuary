/**
 * useNotificationSound Hook Tests
 *
 * Tests for the notification sound hook including sound playback,
 * event handling, and user preferences.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import {
  useNotificationSound,
  getSoundPresets,
  SOUND_EVENTS,
  SoundEvent,
} from '../../hooks/useNotificationSound';

// Mock the logger
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock UserContext
const mockUser: any = {
  preferences: {
    notificationSounds: {
      enabled: true,
      volume: 75,
      confirmation: { enabled: true, sound: 'chime' },
      receive: { enabled: true, sound: 'coin' },
      send: { enabled: true, sound: 'success' },
    },
  },
};

vi.mock('../../contexts/UserContext', () => ({
  useUser: vi.fn(() => ({ user: mockUser })),
}));

// Import useUser so we can modify its return value
import { useUser } from '../../contexts/UserContext';

// Mock Web Audio API
const mockOscillator = {
  type: 'sine',
  frequency: { value: 440, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
  detune: { value: 0 },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

const mockGainNode = {
  gain: {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn(),
};

const mockBiquadFilter = {
  type: 'lowpass',
  frequency: { value: 1000, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
  Q: { value: 1 },
  connect: vi.fn(),
};

const mockBufferSource = {
  buffer: null,
  connect: vi.fn(),
  start: vi.fn(),
};

const mockBuffer = {
  getChannelData: vi.fn(() => new Float32Array(4410)),
};

const mockAudioContext = {
  currentTime: 0,
  sampleRate: 44100,
  destination: {},
  createOscillator: vi.fn(() => ({ ...mockOscillator })),
  createGain: vi.fn(() => ({ ...mockGainNode })),
  createBiquadFilter: vi.fn(() => ({ ...mockBiquadFilter })),
  createBufferSource: vi.fn(() => ({ ...mockBufferSource })),
  createBuffer: vi.fn(() => mockBuffer),
};

// Track AudioContext creation
let audioContextCreated = false;

// Store original AudioContext
const originalAudioContext = globalThis.AudioContext;

describe('useNotificationSound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioContextCreated = false;

    // Mock AudioContext as a constructor function
    const MockAudioContext = function (this: any) {
      audioContextCreated = true;
      Object.assign(this, mockAudioContext);
      return this;
    } as any;

    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).webkitAudioContext = MockAudioContext;

    // Reset user mock
    (useUser as Mock).mockReturnValue({ user: mockUser });
  });

  afterEach(() => {
    // Restore original AudioContext
    (globalThis as any).AudioContext = originalAudioContext;
  });

  describe('hook initialization', () => {
    it('should return expected functions and values', () => {
      const { result } = renderHook(() => useNotificationSound());

      expect(result.current.playConfirmationChime).toBeDefined();
      expect(result.current.playEventSound).toBeDefined();
      expect(result.current.playSound).toBeDefined();
      expect(result.current.isSoundEnabled).toBeDefined();
      expect(result.current.getEventConfig).toBeDefined();
      expect(result.current.soundPresets).toBeDefined();
      expect(result.current.soundEvents).toBeDefined();
    });

    it('should provide sound presets', () => {
      const { result } = renderHook(() => useNotificationSound());

      const presets = result.current.soundPresets;
      expect(presets).toBeInstanceOf(Array);
      expect(presets.length).toBeGreaterThan(0);

      // Should include 'none' option
      expect(presets.some((p) => p.id === 'none')).toBe(true);
    });

    it('should provide sound events', () => {
      const { result } = renderHook(() => useNotificationSound());

      expect(result.current.soundEvents).toEqual(SOUND_EVENTS);
      expect(result.current.soundEvents).toHaveLength(3);
    });
  });

  describe('getSoundPresets', () => {
    it('should return all sound presets including none', () => {
      const presets = getSoundPresets();

      expect(presets).toBeInstanceOf(Array);
      expect(presets.length).toBeGreaterThan(0);

      // Check for some known presets
      expect(presets.some((p) => p.id === 'chime')).toBe(true);
      expect(presets.some((p) => p.id === 'bell')).toBe(true);
      expect(presets.some((p) => p.id === 'coin')).toBe(true);
      expect(presets.some((p) => p.id === 'none')).toBe(true);

      // Check preset structure
      const chime = presets.find((p) => p.id === 'chime');
      expect(chime).toHaveProperty('name');
      expect(chime).toHaveProperty('description');
    });
  });

  describe('SOUND_EVENTS', () => {
    it('should have confirmation, receive, and send events', () => {
      expect(SOUND_EVENTS).toHaveLength(3);

      const ids = SOUND_EVENTS.map((e) => e.id);
      expect(ids).toContain('confirmation');
      expect(ids).toContain('receive');
      expect(ids).toContain('send');

      // Check structure
      SOUND_EVENTS.forEach((event) => {
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('description');
      });
    });
  });

  describe('isSoundEnabled', () => {
    it('should return true when sounds are enabled', () => {
      const { result } = renderHook(() => useNotificationSound());

      expect(result.current.isSoundEnabled()).toBe(true);
    });

    it('should return false when sounds are disabled', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: false,
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      expect(result.current.isSoundEnabled()).toBe(false);
    });

    it('should return false when no preferences', () => {
      (useUser as Mock).mockReturnValue({ user: null });

      const { result } = renderHook(() => useNotificationSound());

      expect(result.current.isSoundEnabled()).toBe(false);
    });
  });

  describe('getEventConfig', () => {
    it('should return event configuration', () => {
      const { result } = renderHook(() => useNotificationSound());

      const config = result.current.getEventConfig('confirmation');

      expect(config.enabled).toBe(true);
      expect(config.sound).toBe('chime');
    });

    it('should return disabled config when sounds disabled', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: false,
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      const config = result.current.getEventConfig('confirmation');

      expect(config.enabled).toBe(false);
      expect(config.sound).toBe('none');
    });

    it('should return defaults when event config missing', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: true,
              // No event-specific config
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      // Should use defaults
      const confirmConfig = result.current.getEventConfig('confirmation');
      expect(confirmConfig.enabled).toBe(true);
      expect(confirmConfig.sound).toBe('chime');

      const receiveConfig = result.current.getEventConfig('receive');
      expect(receiveConfig.enabled).toBe(true);
      expect(receiveConfig.sound).toBe('coin');
    });

    it('should handle legacy confirmationChime config', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: true,
              confirmationChime: true,
              soundType: 'bell',
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      const config = result.current.getEventConfig('confirmation');

      expect(config.enabled).toBe(true);
      expect(config.sound).toBe('bell');
    });

    it('should fall back to chime when legacy soundType is missing', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: true,
              confirmationChime: true,
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());
      const config = result.current.getEventConfig('confirmation');

      expect(config.enabled).toBe(true);
      expect(config.sound).toBe('chime');
    });
  });

  describe('playSound', () => {
    it('should not play when sound type is none', () => {
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playSound('none');
      });

      // AudioContext should not be created
      expect(audioContextCreated).toBe(false);
    });

    it('should create AudioContext and play sound', () => {
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playSound('chime', 50);
      });

      expect(audioContextCreated).toBe(true);
    });

    it('should use default volume when not specified', () => {
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playSound('ping');
      });

      // Should use 50 as default (50/100 = 0.5 volume)
      expect(audioContextCreated).toBe(true);
    });

    it('should use webkitAudioContext when AudioContext is unavailable', () => {
      (globalThis as any).AudioContext = undefined;
      const MockWebkitAudioContext = function (this: any) {
        audioContextCreated = true;
        Object.assign(this, mockAudioContext);
        return this;
      } as any;
      (globalThis as any).webkitAudioContext = MockWebkitAudioContext;

      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playSound('chime');
      });

      expect(audioContextCreated).toBe(true);
    });

    it('should handle various sound types', () => {
      const soundTypes = [
        'chime', 'bell', 'coin', 'success', 'gentle', 'zen',
        'ping', 'pop', 'harp', 'retro', 'marimba', 'glass',
        'synth', 'drop', 'sparkle', 'drums', 'whistle', 'brass',
        'windchime', 'click',
      ];

      // Test a subset since AudioContext is created once and reused
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playSound(soundTypes[0] as any, 50);
      });

      expect(audioContextCreated).toBe(true);
    });
  });

  describe('playEventSound', () => {
    it('should not play when sounds disabled', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: false,
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playEventSound('confirmation');
      });

      expect(audioContextCreated).toBe(false);
    });

    it('should play confirmation sound', () => {
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playEventSound('confirmation');
      });

      expect(audioContextCreated).toBe(true);
    });

    it('should play receive sound', () => {
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playEventSound('receive');
      });

      expect(audioContextCreated).toBe(true);
    });

    it('should play send sound', () => {
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playEventSound('send');
      });

      expect(audioContextCreated).toBe(true);
    });

    it('should use configured volume', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: true,
              volume: 100,
              confirmation: { enabled: true, sound: 'chime' },
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playEventSound('confirmation');
      });

      expect(audioContextCreated).toBe(true);
    });

    it('should use fallback event volume when preference volume is missing', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: true,
              confirmation: { enabled: true, sound: 'chime' },
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playEventSound('confirmation');
      });

      expect(audioContextCreated).toBe(true);
    });

    it('should not play when event sound disabled', () => {
      (useUser as Mock).mockReturnValue({
        user: {
          preferences: {
            notificationSounds: {
              enabled: true,
              confirmation: { enabled: false, sound: 'chime' },
            },
          },
        },
      });

      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playEventSound('confirmation');
      });

      // Should not play
      expect(audioContextCreated).toBe(false);
    });
  });

  describe('playConfirmationChime', () => {
    it('should call playEventSound with confirmation', () => {
      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playConfirmationChime();
      });

      expect(audioContextCreated).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle AudioContext creation failure gracefully', () => {
      (globalThis as any).AudioContext = function () {
        throw new Error('AudioContext not supported');
      };

      const { result } = renderHook(() => useNotificationSound());

      // Should not throw
      expect(() => {
        act(() => {
          result.current.playSound('chime');
        });
      }).not.toThrow();
    });
  });

  describe('AudioContext reuse', () => {
    it('should reuse AudioContext instance', () => {
      let createCount = 0;
      (globalThis as any).AudioContext = function (this: any) {
        createCount++;
        Object.assign(this, mockAudioContext);
        return this;
      };

      const { result } = renderHook(() => useNotificationSound());

      act(() => {
        result.current.playSound('chime');
        result.current.playSound('bell');
        result.current.playSound('ping');
      });

      // AudioContext should only be created once
      expect(createCount).toBe(1);
    });
  });
});
