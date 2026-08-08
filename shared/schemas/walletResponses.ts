import { z } from 'zod';

/**
 * Runtime shapes for the wallet and UTXO *responses*.
 *
 * ## `looseObject`, and why it is not optional here
 *
 * zod strips undeclared keys by default. That is harmless for an exhaustive
 * schema like `FeeEstimatesSchema`, which names all five of its fields — but
 * `Wallet` has some twenty-five, and a partial schema under the default would
 * silently *delete* every field it did not declare. Parsing a wallet through
 * `z.object({ balance })` returns `{ balance }` and nothing else: the descriptor,
 * the quorum and the sync state all vanish, and the app breaks in ways that look
 * nothing like a validation failure.
 *
 * So the rule for response schemas is:
 *
 * - exhaustive schema → the default (strip) is fine
 * - partial schema → **must** be `looseObject`, or it is a data-destroying bug
 *
 * These are deliberately partial. They pin the fields whose corruption misleads
 * about money — the balance that is summed, the amount that drives coin
 * selection — and let everything else through untouched.
 *
 * ## Shape, not range
 *
 * `.finite()` is the substance: `z.number()` alone admits Infinity, and it is
 * null/NaN that reach the arithmetic. Whether a value is *sensible* stays with
 * the code that uses it, so an odd-but-readable response degrades a figure
 * rather than blanking a card.
 */

/** Rejects the null/NaN/Infinity that `Number()` and `Math.abs()` turn into 0. */
const satoshis = z.number().finite();

/**
 * `walletDataLoaders` and `loadSendTransactionPageData` call `.map` on `utxos`
 * with no guard, and `Number(utxo.amount)` turns a null into 0 — which drops
 * the UTXO from coin selection without saying so.
 */
export const UtxoSchema = z.looseObject({
  txid: z.string(),
  vout: z.number().int(),
  amount: satoshis,
  address: z.string(),
  confirmations: satoshis,
});

export const GetUtxosResponseSchema = z.looseObject({
  utxos: z.array(UtxoSchema),
  count: satoshis,
  totalBalance: satoshis,
});

/**
 * The dashboard sums this: `reduce((acc, w) => acc + w.balance, 0)`. One null
 * understates the total silently; one undefined makes the whole total NaN.
 */
export const WalletSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  balance: satoshis,
});

export const WalletsResponseSchema = z.array(WalletSchema);

export type ValidatedUtxo = z.infer<typeof UtxoSchema>;
export type ValidatedWallet = z.infer<typeof WalletSchema>;
