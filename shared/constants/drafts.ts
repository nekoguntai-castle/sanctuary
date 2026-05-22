export const ACTIONABLE_DRAFT_STATUS_VALUES = ['unsigned', 'partial', 'signed'] as const;
export const BROADCASTED_DRAFT_STATUS = 'broadcasted';
export const DRAFT_LIFECYCLE_STATUS_VALUES = [
  ...ACTIONABLE_DRAFT_STATUS_VALUES,
  BROADCASTED_DRAFT_STATUS,
] as const;

export type DraftStatus = typeof ACTIONABLE_DRAFT_STATUS_VALUES[number];
export type DraftLifecycleStatus = typeof DRAFT_LIFECYCLE_STATUS_VALUES[number];
