import { describe,expect,it,vi } from 'vitest';
import { SOUND_PRESETS } from '../../src/hooks/soundPresets';

type MockAudioParam = {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
};

function createMockAudioParam(initialValue = 0): MockAudioParam {
  return {
    value: initialValue,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function createMockAudioContext() {
  const createOscillator = vi.fn(() => ({
    type: 'sine',
    frequency: createMockAudioParam(440),
    detune: createMockAudioParam(0),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));

  const createGain = vi.fn(() => ({
    gain: createMockAudioParam(1),
    connect: vi.fn(),
  }));

  const createBiquadFilter = vi.fn(() => ({
    type: 'lowpass',
    frequency: createMockAudioParam(1000),
    Q: { value: 1 },
    connect: vi.fn(),
  }));

  const createBuffer = vi.fn((_: number, length: number) => ({
    getChannelData: vi.fn(() => new Float32Array(length)),
  }));

  const createBufferSource = vi.fn(() => ({
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));

  return {
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createOscillator,
    createGain,
    createBiquadFilter,
    createBuffer,
    createBufferSource,
  };
}

describe('SOUND_PRESETS', () => {
  it('contains a non-empty preset catalog with name/description/play', () => {
    const entries = Object.entries(SOUND_PRESETS);
    expect(entries.length).toBeGreaterThan(10);

    for (const [id, preset] of entries) {
      expect(id.length).toBeGreaterThan(0);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(typeof preset.play).toBe('function');
    }
  });

  it.each(Object.keys(SOUND_PRESETS))('plays "%s" without throwing', (presetId) => {
    const ctx = createMockAudioContext();
    const preset = SOUND_PRESETS[presetId as keyof typeof SOUND_PRESETS];

    expect(() => preset.play(ctx as unknown as AudioContext, 0.5)).not.toThrow();
    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(ctx.createGain).toHaveBeenCalled();
  });
});
