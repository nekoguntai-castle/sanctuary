import * as bitcoinApi from '../../../src/api/bitcoin';
import * as devicesApi from '../../../src/api/devices';
import type { DraftTransaction } from '../../../src/api/drafts';
import * as transactionsApi from '../../../src/api/transactions';
import * as walletsApi from '../../../src/api/wallets';
import type { Device } from '../../../types';
import { createLogger } from '../../../utils/logger';
import {
  buildDraftTxData,
  buildInitialState,
  formatFees,
  formatMempoolData,
  formatUtxos,
  formatWallet,
  formatWalletAddresses,
  resolveWalletDevices,
} from './sendTransactionPageHelpers';
import type { SendTransactionLoadResult } from './types';

const log = createLogger('SendTxPage');

interface LoadSendTransactionPageDataParams {
  draftData?: DraftTransaction;
  preSelectedUTXOs?: string[];
  showInfo: (message: string) => void;
  userId: string;
  walletId: string;
}

export async function loadSendTransactionPageData({
  draftData,
  preSelectedUTXOs,
  showInfo,
  userId,
  walletId,
}: LoadSendTransactionPageDataParams): Promise<SendTransactionLoadResult> {
  const apiWallet = await walletsApi.getWallet(walletId);

  if (apiWallet.userRole === 'viewer') {
    return { kind: 'viewer' };
  }

  const wallet = formatWallet(apiWallet, userId);
  const [utxoData, feeEstimates, mempoolData, addressData, allDevices] = await Promise.all([
    transactionsApi.getUTXOs(walletId),
    bitcoinApi.getFeeEstimates(),
    bitcoinApi.getMempoolData().catch(() => null),
    transactionsApi.getAddresses(walletId).catch(() => []),
    devicesApi.getDevices().catch(() => []),
  ]);

  const utxos = formatUtxos(utxoData.utxos, wallet.scriptType);
  const { mempoolBlocks, queuedBlocksSummary } = formatMempoolData(mempoolData);
  const walletAddresses = formatWalletAddresses(addressData);
  const devices = resolveWalletDevices(apiWallet, allDevices, walletId);

  logWalletAddressResult(walletAddresses);
  logDeviceFiltering(walletId, allDevices, devices);
  logDraftLoad(draftData);

  return {
    kind: 'loaded',
    data: {
      devices,
      draftTxData: draftData ? buildDraftTxData(draftData) : undefined,
      fees: formatFees(feeEstimates),
      initialState: buildInitialState({
        addresses: addressData,
        draftData,
        preSelectedUTXOs,
        showInfo,
        utxos,
      }),
      mempoolBlocks,
      queuedBlocksSummary,
      utxos,
      wallet,
      walletAddresses,
    },
  };
}

function logWalletAddressResult(walletAddresses: Array<{ address: string }>) {
  if (walletAddresses.length === 0) {
    log.warn('No wallet addresses loaded for label lookup');
    return;
  }

  log.info('Wallet addresses loaded:', {
    count: walletAddresses.length,
    sample: walletAddresses.slice(0, 3).map((address) => `${address.address.substring(0, 20)}...`),
  });
}

function logDeviceFiltering(walletId: string, allDevices: Device[], matchedDevices: Device[]) {
  log.info('Device filtering debug:', {
    walletId,
    totalDevices: allDevices.length,
    deviceDetails: allDevices.map((device) => ({
      id: device.id,
      type: device.type,
      label: device.label,
      fingerprint: device.fingerprint,
      wallets: device.wallets?.map((walletRef) => ({
        walletId: walletRef.wallet?.id,
        walletName: walletRef.wallet?.name,
      })),
    })),
  });

  log.info('Filtered devices for wallet:', {
    walletId,
    matchedDevices: matchedDevices.map((device) => ({
      id: device.id,
      type: device.type,
      label: device.label,
    })),
  });
}

function logDraftLoad(draftData?: DraftTransaction) {
  if (!draftData) return;

  const unsignedPsbtToUse = draftData.signedPsbtBase64 || draftData.psbtBase64;
  log.info('Loading draft data:', {
    draftId: draftData.id,
    hasPsbtBase64: !!draftData.psbtBase64,
    hasSignedPsbtBase64: !!draftData.signedPsbtBase64,
    outputCount: draftData.outputs?.length ?? 1,
    psbtLength: unsignedPsbtToUse?.length,
    psbtPreview: `${unsignedPsbtToUse?.substring(0, 30)}...`,
    recipient: `${draftData.recipient?.substring(0, 20)}...`,
  });
}
