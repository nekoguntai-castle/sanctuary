export * from './adminReads';
export * from './addressReads';
export * from './draftReads';
export * from './insightReads';
export * from './labelReads';
export * from './policyReads';
export * from './publicReads';
export * from './transactionReads';
export * from './utxoReads';
export * from './walletReads';

import { findAdminAgentDashboardRowsForAssistant } from './adminReads';
import { getAddressSummary, findAddressDetail, searchAddresses } from './addressReads';
import { countDrafts, findDraftDetailForAssistant } from './draftReads';
import { findWalletInsightDetailForAssistant, findWalletInsightsForAssistant } from './insightReads';
import { findWalletLabelDetailForAssistant, findWalletLabelsForAssistant } from './labelReads';
import {
  findWalletPoliciesForAssistant,
  findWalletPolicyDetailForAssistant,
  findWalletPolicyEventsForAssistant,
} from './policyReads';
import { checkDatabase, getLatestFeeEstimate, getLatestPrice } from './publicReads';
import {
  aggregateFees,
  findPendingTransactions,
  findWalletTransactionDetail,
  findWalletTransactions,
  getTransactionStats,
  queryTransactions,
} from './transactionReads';
import { getUtxoSummary, queryUtxos } from './utxoReads';
import {
  findWalletDetailSummary,
  getDashboardSummary,
  getWalletBalance,
} from './walletReads';

export const assistantReadRepository = {
  checkDatabase,
  getLatestFeeEstimate,
  getLatestPrice,
  getDashboardSummary,
  getWalletBalance,
  findWalletDetailSummary,
  findWalletTransactions,
  findWalletTransactionDetail,
  getTransactionStats,
  findPendingTransactions,
  queryTransactions,
  queryUtxos,
  getUtxoSummary,
  searchAddresses,
  getAddressSummary,
  findAddressDetail,
  countDrafts,
  findDraftDetailForAssistant,
  aggregateFees,
  findWalletLabelsForAssistant,
  findWalletLabelDetailForAssistant,
  findWalletPoliciesForAssistant,
  findWalletPolicyDetailForAssistant,
  findWalletPolicyEventsForAssistant,
  findWalletInsightsForAssistant,
  findWalletInsightDetailForAssistant,
  findAdminAgentDashboardRowsForAssistant,
};

export default assistantReadRepository;
