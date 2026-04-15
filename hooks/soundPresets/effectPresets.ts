import type { SoundPresetPick } from './types';

export const effectSoundPresets = {
  drop: {
    name: 'Drop',
    description: 'Water droplet',
    play: (ctx, volume) => {
      const now = ctx.currentTime;

      // Primary drop - frequency sweep down
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.15);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume * 0.3, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);

      // Ripple effect
      [0.15, 0.25].forEach((delay, i) => {
        const ripple = ctx.createOscillator();
        ripple.type = 'sine';
        ripple.frequency.setValueAtTime(800 - i * 200, now + delay);
        ripple.frequency.exponentialRampToValueAtTime(300, now + delay + 0.1);

        const rippleGain = ctx.createGain();
        rippleGain.gain.setValueAtTime(0, now + delay);
        rippleGain.gain.linearRampToValueAtTime(volume * 0.1, now + delay + 0.01);
        rippleGain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15);

        ripple.connect(rippleGain);
        rippleGain.connect(ctx.destination);
        ripple.start(now + delay);
        ripple.stop(now + delay + 0.2);
      });
    },
  },

  sparkle: {
    name: 'Sparkle',
    description: 'Magical shimmer',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Random high frequencies for sparkle effect
      const sparkles = [
        { freq: 2400, time: 0, dur: 0.3 },
        { freq: 3200, time: 0.05, dur: 0.25 },
        { freq: 2800, time: 0.1, dur: 0.3 },
        { freq: 3600, time: 0.15, dur: 0.2 },
        { freq: 2000, time: 0.2, dur: 0.35 },
        { freq: 4000, time: 0.25, dur: 0.25 },
      ];

      sparkles.forEach(({ freq, time, dur }) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        const startTime = now + time;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.12, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.05);
      });
    },
  },

  drums: {
    name: 'Drums',
    description: 'Short drum fill',
    play: (ctx, volume) => {
      const now = ctx.currentTime;

      // Kick drum
      const kick = ctx.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(150, now);
      kick.frequency.exponentialRampToValueAtTime(40, now + 0.1);

      const kickGain = ctx.createGain();
      kickGain.gain.setValueAtTime(volume * 0.5, now);
      kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      kick.connect(kickGain);
      kickGain.connect(ctx.destination);
      kick.start(now);
      kick.stop(now + 0.2);

      // Snare-like noise
      const snareTime = now + 0.15;
      const bufferSize = ctx.sampleRate * 0.1;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 1000;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * 0.25, snareTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, snareTime + 0.08);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(snareTime);

      // Hi-hat
      const hatTime = now + 0.25;
      const hatBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
      const hatData = hatBuffer.getChannelData(0);
      for (let i = 0; i < hatData.length; i++) {
        hatData[i] = Math.random() * 2 - 1;
      }

      const hat = ctx.createBufferSource();
      hat.buffer = hatBuffer;

      const hatFilter = ctx.createBiquadFilter();
      hatFilter.type = 'highpass';
      hatFilter.frequency.value = 7000;

      const hatGain = ctx.createGain();
      hatGain.gain.setValueAtTime(volume * 0.15, hatTime);
      hatGain.gain.exponentialRampToValueAtTime(0.001, hatTime + 0.05);

      hat.connect(hatFilter);
      hatFilter.connect(hatGain);
      hatGain.connect(ctx.destination);
      hat.start(hatTime);
    },
  },

  whistle: {
    name: 'Whistle',
    description: 'Short melody whistle',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Simple whistle melody
      const notes = [
        { freq: 880, start: 0, dur: 0.15 },
        { freq: 1047, start: 0.15, dur: 0.15 },
        { freq: 1319, start: 0.3, dur: 0.25 },
      ];

      notes.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        // Slight vibrato
        const vibrato = ctx.createOscillator();
        vibrato.type = 'sine';
        vibrato.frequency.value = 6;
        const vibratoGain = ctx.createGain();
        vibratoGain.gain.value = 8;
        vibrato.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);

        const gainNode = ctx.createGain();
        const startTime = now + start;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.02);
        gainNode.gain.setValueAtTime(volume * 0.12, startTime + dur - 0.03);
        gainNode.gain.linearRampToValueAtTime(0, startTime + dur);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        vibrato.start(startTime);
        vibrato.stop(startTime + dur);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.05);
      });
    },
  },

  brass: {
    name: 'Brass',
    description: 'Bold brass stab',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Brass chord with sawtooth waves
      const notes = [349.23, 440, 523.25]; // F4, A4, C5 - F major

      notes.forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, now);
        filter.frequency.linearRampToValueAtTime(2500, now + 0.05);
        filter.frequency.linearRampToValueAtTime(1500, now + 0.3);
        filter.Q.value = 1;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume * 0.12, now + 0.03);
        gainNode.gain.setValueAtTime(volume * 0.1, now + 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.55);
      });
    },
  },

  windchime: {
    name: 'Wind Chime',
    description: 'Delicate chimes',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Random-ish high metallic tones
      const chimes = [
        { freq: 1568, time: 0 },
        { freq: 2093, time: 0.1 },
        { freq: 1760, time: 0.18 },
        { freq: 2349, time: 0.28 },
        { freq: 1975, time: 0.4 },
      ];

      chimes.forEach(({ freq, time }) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        // Add slight harmonic
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = freq * 2.4;

        const gainNode = ctx.createGain();
        const startTime = now + time;
        const duration = 1.2;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.1, startTime + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.03, startTime + 0.3);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(volume * 0.03, startTime + 0.005);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.6);

        osc.connect(gainNode);
        osc2.connect(gain2);
        gainNode.connect(ctx.destination);
        gain2.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration + 0.1);
        osc2.start(startTime);
        osc2.stop(startTime + duration * 0.7);
      });
    },
  },

  click: {
    name: 'Click',
    description: 'Subtle click',
    play: (ctx, volume) => {
      const now = ctx.currentTime;

      // Short click with slight resonance
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1000;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2000;
      filter.Q.value = 5;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(volume * 0.3, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);

      // Second softer click
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 800;

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(volume * 0.15, now + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc2.connect(filter);
      filter.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.1);
    },
  },
} satisfies SoundPresetPick<'drop' | 'sparkle' | 'drums' | 'whistle' | 'brass' | 'windchime' | 'click'>;
