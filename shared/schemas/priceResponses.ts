import { z } from 'zod';

/**
 * Runtime shape for the fiat price response.
 *
 * `PriceContext` does `setBtcPrice(priceData.price)` with no finiteness check,
 * and the guard downstream in `CurrencyContext` is `btcPrice === null` — which
 * NaN sails straight through. `satsToBTC(sats) * NaN` is NaN, so a single bad
 * number here turns *every fiat figure in the application* into `NaN`, with no
 * error and nothing in the console.
 *
 * Partial and loose, per the rule in `walletResponses`: only the fields whose
 * corruption spreads are pinned, and everything else passes through.
 */

const fiat = z.number().finite();

export const PriceSourceSchema = z.looseObject({
  provider: z.string(),
  price: fiat,
  currency: z.string(),
});

export const AggregatedPriceSchema = z.looseObject({
  price: fiat,
  currency: z.string(),
  median: fiat,
  average: fiat,
  // `new Date(priceData.timestamp)` — a non-string yields an Invalid Date that
  // renders as "Invalid Date" rather than failing.
  timestamp: z.string(),
  sources: z.array(PriceSourceSchema),
  // Deliberately the most permissive field here, and the first answer to the
  // plan's open question about whether a cosmetic field may reject a response.
  //
  // It is a percentage badge. `price` is what every fiat figure in the app is
  // derived from. Letting the badge veto the price would trade a small wrong
  // thing for a large missing one, so this accepts number, null or absent —
  // the server omits it when no provider reports one, and `PriceContext`
  // already normalises with `?? null`. If it arrives as something stranger it
  // is still rejected, because then we do not know what it is.
  change24h: fiat.nullish(),
});
