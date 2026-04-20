import type { SystemSettings } from '../../src/api/admin';

export const DEFAULT_CONFIRMATION_THRESHOLD = 1;
export const DEFAULT_DEEP_CONFIRMATION_THRESHOLD = 3;
export const DEFAULT_DUST_THRESHOLD = 546;
export const INVALID_DEEP_CONFIRMATION_MESSAGE =
  'Deep confirmation threshold must be greater than or equal to confirmation threshold';

export interface VariableThresholds {
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  dustThreshold: number;
}

export function resolveVariableThresholds(settings: SystemSettings): VariableThresholds {
  return {
    confirmationThreshold: settings.confirmationThreshold ?? DEFAULT_CONFIRMATION_THRESHOLD,
    deepConfirmationThreshold: settings.deepConfirmationThreshold ?? DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
    dustThreshold: settings.dustThreshold ?? DEFAULT_DUST_THRESHOLD,
  };
}

export function parseConfirmationThreshold(value: string): number {
  return Math.max(1, Number.parseInt(value, 10) || DEFAULT_CONFIRMATION_THRESHOLD);
}

export function parseDeepConfirmationThreshold(value: string): number {
  return Number.parseInt(value, 10) || DEFAULT_CONFIRMATION_THRESHOLD;
}

export function parseDustThreshold(value: string): number {
  return Math.max(1, Number.parseInt(value, 10) || DEFAULT_DUST_THRESHOLD);
}

export function validateThresholds({
  confirmationThreshold,
  deepConfirmationThreshold,
}: VariableThresholds): string | null {
  if (deepConfirmationThreshold < confirmationThreshold) {
    return INVALID_DEEP_CONFIRMATION_MESSAGE;
  }

  return null;
}
