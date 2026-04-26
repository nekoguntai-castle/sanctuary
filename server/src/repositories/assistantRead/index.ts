export * from './addressReads';
export * from './draftReads';
export * from './publicReads';
export * from './transactionReads';
export * from './utxoReads';
export * from './walletReads';

import { getAddressSummary, findAddressDetail, searchAddresses } from './addressReads';
import { countDrafts } from './draftReads';
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
  aggregateFees,
};

export default assistantReadRepository;
