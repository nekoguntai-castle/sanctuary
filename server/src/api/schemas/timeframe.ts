import { z } from 'zod';

/** Shared history/activity periods; each endpoint supplies its own fallback. */
export const TimeframeSchema = z.enum(['1D', '1W', '1M', '1Y', 'ALL']);
