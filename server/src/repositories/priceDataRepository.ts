/**
 * Price Data Repository
 *
 * Writes assistant-facing cache snapshots for BTC prices and fee estimates.
 */

import prisma from '../models/prisma';

export interface InsertPriceDataInput {
  currency: string;
  price: number;
  source: string;
}

export interface InsertFeeEstimateInput {
  fastest: number;
  halfHour: number;
  hour: number;
}

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

export async function insertPriceData(input: InsertPriceDataInput) {
  return prisma.priceData.create({
    data: {
      currency: normalizeCurrency(input.currency),
      price: input.price,
      source: input.source,
    },
  });
}

export async function insertFeeEstimate(input: InsertFeeEstimateInput) {
  return prisma.feeEstimate.create({
    data: {
      fastest: input.fastest,
      halfHour: input.halfHour,
      hour: input.hour,
    },
  });
}

export const priceDataRepository = {
  insertPriceData,
  insertFeeEstimate,
};

export default priceDataRepository;
