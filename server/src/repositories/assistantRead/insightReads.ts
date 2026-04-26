import { intelligenceRepository, type InsightFilter } from '../intelligenceRepository';

export async function findWalletInsightsForAssistant(
  walletId: string,
  filters: Omit<InsightFilter, 'walletId'>,
  limit: number
) {
  return intelligenceRepository.findInsightsByWallet(walletId, filters, limit, 0);
}

export async function findWalletInsightDetailForAssistant(
  walletId: string,
  insightId: string
) {
  const insight = await intelligenceRepository.findInsightById(insightId);
  if (!insight || insight.walletId !== walletId) {
    return null;
  }
  return insight;
}
