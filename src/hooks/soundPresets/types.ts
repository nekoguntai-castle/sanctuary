import type { SoundType } from '../../types';

/**
 * Sound preset type definition
 */
export interface SoundPreset {
  name: string;
  description: string;
  play: (ctx: AudioContext, volume: number) => void;
}

export type SoundPresetMap = Record<Exclude<SoundType, 'none'>, SoundPreset>;

export type SoundPresetPick<T extends keyof SoundPresetMap> = Pick<SoundPresetMap, T>;
