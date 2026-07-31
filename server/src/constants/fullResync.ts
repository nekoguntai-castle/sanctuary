export const FULL_RESYNC_GENERATION_MAX = 2_147_483_647;

export function isFullResyncGeneration(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= FULL_RESYNC_GENERATION_MAX;
}
