/**
 * useBroadcast Hook
 *
 * Handles transaction broadcasting, including post-broadcast cleanup
 * (query cache refresh, draft deletion, navigation).
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as bitcoin from 'bitcoinjs-lib';
import * as transactionsApi from '../../src/api/transactions';
import * as draftsApi from '../../src/api/drafts';
import { useErrorHandler } from '../useErrorHandler';
import { useNotificationSound } from '../useNotificationSound';
import { useCurrency } from '../../contexts/CurrencyContext';
import { queryClient } from '../../providers/QueryProvider';
import { isMultisigType } from '../../types';
import { createLogger } from '../../utils/logger';
import { toHex } from '../../utils/bufferUtils';
import type { Wallet } from '../../types';
import type { TransactionState } from '../../contexts/send/types';
import type { TransactionData } from './types';

const log = createLogger('Broadcast');

type CurrencyFormatter = (amount: number) => string;
type ShowSuccess = (message: string, title?: string) => void;

interface BroadcastPayloadSelection {
  psbtToUse: string | null;
  rawTxToUse: string | undefined;
  isMultisig: boolean;
  rawTxSkipped: boolean;
}

export interface UseBroadcastDeps {
  walletId: string;
  wallet: Wallet;
  state: TransactionState;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  signedRawTx: string | null;
  setIsBroadcasting: (v: boolean) => void;
  setError: (v: string | null) => void;
}

export interface UseBroadcastResult {
  broadcastTransaction: (signedPsbt?: string, rawTxHex?: string) => Promise<boolean>;
}

const selectBroadcastPayload = (
  wallet: Wallet,
  unsignedPsbt: string | null,
  signedRawTx: string | null,
  signedPsbt?: string,
  rawTxHex?: string
): BroadcastPayloadSelection => {
  const psbtToUse = signedPsbt || unsignedPsbt;
  const isMultisig = isMultisigType(wallet.type);
  const rawTxCandidate = rawTxHex || signedRawTx;

  return {
    psbtToUse,
    rawTxToUse: isMultisig ? undefined : rawTxCandidate ?? undefined,
    isMultisig,
    rawTxSkipped: isMultisig && !!rawTxCandidate,
  };
};

const hasBroadcastPayload = (payload: BroadcastPayloadSelection): boolean => {
  return Boolean(payload.psbtToUse || payload.rawTxToUse);
};

const logBroadcastStart = (payload: BroadcastPayloadSelection): void => {
  log.info('Broadcasting transaction', {
    hasPsbt: !!payload.psbtToUse,
    hasRawTx: !!payload.rawTxToUse,
    isMultisig: payload.isMultisig,
    rawTxSkipped: payload.rawTxSkipped,
  });
};

const logPartialSignatureDetails = (input: bitcoin.Psbt['data']['inputs'][number], inputIndex: number): void => {
  if (!input.partialSig) {
    return;
  }

  log.info('BROADCAST PSBT SIGNATURES', {
    inputIndex,
    signatureCount: input.partialSig.length,
    signatures: input.partialSig.map(ps => ({
      pubkeyPrefix: toHex(ps.pubkey.slice(0, 8)),
      sigLength: ps.signature.length,
      sigHexStart: toHex(ps.signature.slice(0, 10)),
      sigHexEnd: toHex(ps.signature.slice(-5)),
    })),
  });
};

const logMultisigPsbtSignatures = (psbtToUse: string | null, isMultisig: boolean): void => {
  if (!psbtToUse || !isMultisig) {
    return;
  }

  try {
    const debugPsbt = bitcoin.Psbt.fromBase64(psbtToUse);
    debugPsbt.data.inputs.forEach(logPartialSignatureDetails);
  } catch (parseError) {
    log.warn('Failed to parse PSBT for debug', { error: parseError });
  }
};

const getEffectiveAmount = (txData: TransactionData): number => {
  return txData.effectiveAmount || txData.outputs?.reduce((sum, output) => sum + output.amount, 0) || 0;
};

const getOutputsMessage = (
  outputCount: number,
  effectiveAmount: number,
  format: CurrencyFormatter
): string => {
  return outputCount > 1 ? `${outputCount} outputs` : format(effectiveAmount);
};

const showBroadcastSuccess = (
  showSuccess: ShowSuccess,
  format: CurrencyFormatter,
  txid: string,
  outputCount: number,
  effectiveAmount: number,
  fee: number
): void => {
  const outputsMsg = getOutputsMessage(outputCount, effectiveAmount, format);
  showSuccess(
    `Transaction broadcast successfully! TXID: ${txid.substring(0, 16)}... Amount: ${outputsMsg}, Fee: ${format(fee)}`,
    'Transaction Broadcast'
  );
};

const refetchBroadcastCaches = async (walletId: string): Promise<void> => {
  // Refetch React Query caches so Dashboard updates immediately.
  // invalidateQueries only marks as stale and can race with navigate().
  await Promise.all([
    queryClient.refetchQueries({ queryKey: ['pendingTransactions'] }),
    queryClient.refetchQueries({ queryKey: ['wallets'] }),
    queryClient.refetchQueries({ queryKey: ['wallet', walletId] }),
  ]);

  queryClient.invalidateQueries({ queryKey: ['recentTransactions'] });
  queryClient.invalidateQueries({ queryKey: ['transactions', walletId] });
};

const deleteDraftAfterBroadcast = async (walletId: string, draftId: string | null): Promise<void> => {
  if (!draftId) {
    return;
  }

  try {
    await draftsApi.deleteDraft(walletId, draftId);
  } catch (e) {
    log.error('Failed to delete draft after broadcast', { error: e });
  }
};

const getBroadcastErrorMessage = (err: unknown): string => {
  return err instanceof Error ? err.message : 'Failed to broadcast transaction';
};

export function useBroadcast({
  walletId,
  wallet,
  state,
  txData,
  unsignedPsbt,
  signedRawTx,
  setIsBroadcasting,
  setError,
}: UseBroadcastDeps): UseBroadcastResult {
  const navigate = useNavigate();
  const { format } = useCurrency();
  const { showSuccess } = useErrorHandler();
  const { playEventSound } = useNotificationSound();

  // Broadcast signed transaction
  const broadcastTransaction = useCallback(async (
    signedPsbt?: string,
    rawTxHex?: string
  ): Promise<boolean> => {
    if (!txData) {
      setError('No transaction to broadcast');
      return false;
    }

    const payload = selectBroadcastPayload(wallet, unsignedPsbt, signedRawTx, signedPsbt, rawTxHex);

    if (!hasBroadcastPayload(payload)) {
      setError('No signed transaction available');
      return false;
    }

    logBroadcastStart(payload);
    logMultisigPsbtSignatures(payload.psbtToUse, payload.isMultisig);

    setIsBroadcasting(true);
    setError(null);

    try {
      const effectiveAmount = getEffectiveAmount(txData);

      const broadcastResult = await transactionsApi.broadcastTransaction(walletId, {
        signedPsbtBase64: payload.psbtToUse ?? undefined,
        rawTxHex: payload.rawTxToUse ?? undefined,
        recipient: state.outputs[0].address,
        amount: effectiveAmount,
        fee: txData.fee,
        utxos: txData.utxos,
      });

      showBroadcastSuccess(showSuccess, format, broadcastResult.txid, state.outputs.length, effectiveAmount, txData.fee);
      playEventSound('send');
      await refetchBroadcastCaches(walletId);
      await deleteDraftAfterBroadcast(walletId, state.draftId);
      navigate(`/wallets/${walletId}`);
      return true;
    } catch (err) {
      log.error('Transaction broadcast failed', { error: err });
      setError(getBroadcastErrorMessage(err));
      return false;
    } finally {
      setIsBroadcasting(false);
    }
  }, [walletId, txData, unsignedPsbt, signedRawTx, state, format, showSuccess, playEventSound, navigate, wallet.type, setIsBroadcasting, setError]);

  return { broadcastTransaction };
}
