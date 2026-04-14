/**
 * Transaction & Address Validation Schemas
 *
 * Zod schemas for transaction and address endpoints.
 */

import { z } from 'zod';

// =============================================================================
// Address Generation
// =============================================================================

/**
 * POST /wallets/:walletId/addresses/generate body
 *
 * `count` is optional with a default of 10. The upper bound prevents a DoS
 * vector: without it, a caller with wallet edit access could request e.g.
 * `count: 1000000` and force the handler to perform millions of
 * CPU-bound descriptor derivations plus a bulk insert.
 *
 * `count: 0` is explicitly allowed (no-op) — documented behavior enshrined by
 * tests/integration/flows/transactions.integration.test.ts.
 *
 * No `z.coerce` — a non-number body value (e.g. `{"count":"5"}`) should be
 * rejected outright. String arithmetic in the handler loop bound would
 * otherwise break silently.
 */
export const GenerateAddressesBodySchema = z.object({
  count: z.number().int().min(0).max(1000).default(10),
});

export type GenerateAddressesBody = z.infer<typeof GenerateAddressesBodySchema>;
