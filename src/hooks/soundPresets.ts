import { effectSoundPresets } from './soundPresets/effectPresets';
import type { SoundPresetMap } from './soundPresets/types';

export type { SoundPreset } from './soundPresets/types';

/**
 * Sound preset definitions
 * Each preset creates a unique audio experience using Web Audio API
 */
export const SOUND_PRESETS: SoundPresetMap = {
  chime: {
    name: 'Chime',
    description: 'Pleasant chord arpeggio',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // C major chord arpeggio: C5, E5, G5, C6
      const frequencies = [523.25, 659.25, 783.99, 1046.5];
      const durations = [0.8, 0.7, 0.6, 0.5];

      frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.08;
        const duration = durations[i];

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.25, startTime + 0.015);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.12, startTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      });
    },
  },

  bell: {
    name: 'Bell',
    description: 'Classic bell tone',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Bell harmonics based on a strike note
      const fundamental = 880; // A5
      const harmonics = [1, 2.4, 3, 4.5, 5.2]; // Bell harmonic ratios
      const amplitudes = [1, 0.6, 0.4, 0.25, 0.2];

      harmonics.forEach((ratio, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = fundamental * ratio;

        const gainNode = ctx.createGain();
        const amp = amplitudes[i] * volume * 0.15;

        // Bell envelope - quick attack, long decay
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(amp, now + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(amp * 0.7, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.5);
      });
    },
  },

  coin: {
    name: 'Coin',
    description: 'Playful coin sound',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Rising arpeggio like collecting a coin
      const notes = [987.77, 1174.66, 1318.51, 1567.98]; // B5, D6, E6, G6

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;

        // Low-pass filter to soften square wave
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3000;

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.07;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.12, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.2);
      });

      // Final shimmer
      const shimmer = ctx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.value = 2093; // C7

      const shimmerGain = ctx.createGain();
      const shimmerStart = now + 0.28;
      shimmerGain.gain.setValueAtTime(0, shimmerStart);
      shimmerGain.gain.linearRampToValueAtTime(volume * 0.1, shimmerStart + 0.02);
      shimmerGain.gain.exponentialRampToValueAtTime(0.001, shimmerStart + 0.3);

      shimmer.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      shimmer.start(shimmerStart);
      shimmer.stop(shimmerStart + 0.3);
    },
  },

  success: {
    name: 'Success',
    description: 'Triumphant fanfare',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Fanfare: two-part ascending melody
      const melody = [
        { freq: 523.25, start: 0, dur: 0.15 },      // C5
        { freq: 659.25, start: 0.12, dur: 0.15 },   // E5
        { freq: 783.99, start: 0.24, dur: 0.3 },    // G5 (held)
        { freq: 1046.5, start: 0.5, dur: 0.5 },     // C6 (final, longer)
      ];

      melody.forEach(({ freq, start, dur }) => {
        // Main tone
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        const startTime = now + start;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.2, startTime + 0.02);
        gainNode.gain.setValueAtTime(volume * 0.18, startTime + dur * 0.5);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.1);

        // Octave doubling for richness
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = freq * 2;

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(volume * 0.08, startTime + 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + dur * 0.8);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(startTime);
        osc2.stop(startTime + dur);
      });
    },
  },

  gentle: {
    name: 'Gentle',
    description: 'Soft notification',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Soft two-note chime
      const notes = [
        { freq: 440, start: 0, dur: 0.6 },      // A4
        { freq: 554.37, start: 0.15, dur: 0.5 }, // C#5 (major third)
      ];

      notes.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        // Low-pass filter for softness
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1500;
        filter.Q.value = 0.5;

        const gainNode = ctx.createGain();
        const startTime = now + start;

        // Very gentle envelope
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.08, startTime + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.1);
      });
    },
  },

  zen: {
    name: 'Zen',
    description: 'Peaceful meditation tone',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Tibetan bowl-like sound with beating frequencies
      const fundamental = 256; // C4 - grounding frequency

      // Two slightly detuned oscillators for natural beating
      [fundamental, fundamental * 1.002].forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume * 0.12, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.1, now + 0.5);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 2.5);
      });

      // Add harmonic overtone
      const harmonic = ctx.createOscillator();
      harmonic.type = 'sine';
      harmonic.frequency.value = fundamental * 3; // Fifth harmonic

      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(0, now);
      harmGain.gain.linearRampToValueAtTime(volume * 0.04, now + 0.15);
      harmGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

      harmonic.connect(harmGain);
      harmGain.connect(ctx.destination);
      harmonic.start(now);
      harmonic.stop(now + 1.5);
    },
  },

  ping: {
    name: 'Ping',
    description: 'Quick, clean ping',
    play: (ctx, volume) => {
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 1800;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume * 0.3, now + 0.005);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);

      // Second ping slightly delayed and higher
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 2400;

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0, now + 0.08);
      gain2.gain.linearRampToValueAtTime(volume * 0.2, now + 0.085);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.25);
    },
  },

  pop: {
    name: 'Pop',
    description: 'Bubbly pop sound',
    play: (ctx, volume) => {
      const now = ctx.currentTime;

      // Frequency sweep for pop effect
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.1);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume * 0.4, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);

      // Second pop
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(600, now + 0.1);
      osc2.frequency.exponentialRampToValueAtTime(200, now + 0.2);

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0, now + 0.1);
      gain2.gain.linearRampToValueAtTime(volume * 0.25, now + 0.11);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.3);
    },
  },

  harp: {
    name: 'Harp',
    description: 'Ethereal harp glissando',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Pentatonic scale for pleasant harp sound
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C5 pentatonic-ish

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        // Slight vibrato for realism
        const vibrato = ctx.createOscillator();
        vibrato.type = 'sine';
        vibrato.frequency.value = 5;
        const vibratoGain = ctx.createGain();
        vibratoGain.gain.value = 3;
        vibrato.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.06;
        const duration = 0.8 - i * 0.08;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.08, startTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        vibrato.start(startTime);
        vibrato.stop(startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.1);
      });
    },
  },

  retro: {
    name: 'Retro',
    description: '8-bit style blips',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Classic 8-bit ascending sound
      const notes = [
        { freq: 440, dur: 0.08 },
        { freq: 554, dur: 0.08 },
        { freq: 659, dur: 0.08 },
        { freq: 880, dur: 0.15 },
      ];

      let time = now;
      notes.forEach(({ freq, dur }) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;

        // Bit crusher effect via low sample rate oscillator
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 4000;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(volume * 0.12, time);
        gainNode.gain.setValueAtTime(0.001, time + dur - 0.01);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + dur);

        time += dur;
      });
    },
  },

  marimba: {
    name: 'Marimba',
    description: 'Warm wooden tone',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Marimba uses triangle wave with quick decay
      const notes = [392, 523.25, 659.25]; // G4, C5, E5

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        // Resonant filter for wooden character
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq * 2;
        filter.Q.value = 2;

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.12;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.35, startTime + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.1, startTime + 0.08);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.5);
      });
    },
  },

  glass: {
    name: 'Glass',
    description: 'Crystal glass tap',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // High frequency with fast decay for glass-like sound
      const fundamentals = [2093, 2637, 3136]; // C7, E7, G7

      fundamentals.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.05;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.002);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.9);
      });
    },
  },

  synth: {
    name: 'Synth',
    description: 'Warm synth pad',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Detuned sawtooth waves for rich synth sound
      const baseFreq = 220; // A3

      [-5, 0, 5, 7].forEach((detune) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = baseFreq;
        osc.detune.value = detune;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, now);
        filter.frequency.linearRampToValueAtTime(2000, now + 0.2);
        filter.frequency.linearRampToValueAtTime(800, now + 0.6);
        filter.Q.value = 2;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume * 0.08, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.06, now + 0.3);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.9);
      });
    },
  },

  ...effectSoundPresets,
};
