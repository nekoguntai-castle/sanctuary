import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/Button';
import { AlertTriangle, TrendingUp, Zap, Users, ArrowUpCircle, Loader2, CheckCircle } from 'lucide-react';
import * as bitcoinApi from '../src/api/bitcoin';
import * as draftsApi from '../src/api/drafts';
import * as transactionsApi from '../src/api/transactions';
import { createLogger } from '../utils/logger';

const log = createLogger('TransactionActions');

interface TransactionActionsProps {
  txid: string;
  walletId: string;
  confirmed: boolean;
  isReceived: boolean;
  onActionComplete?: () => void;
}

export const TransactionActions: React.FC<TransactionActionsProps> = ({
  txid,
  walletId,
  confirmed,
  isReceived,
  onActionComplete,
}) => {
  const navigate = useNavigate();
  const [rbfStatus, setRbfStatus] = useState<bitcoinApi.RBFCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showRBFModal, setShowRBFModal] = useState(false);
  const [showCPFPModal, setShowCPFPModal] = useState(false);
  const [newFeeRate, setNewFeeRate] = useState<number>(0);
  const [targetFeeRate, setTargetFeeRate] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkRBFStatus = async () => {
      if (confirmed) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const result = await bitcoinApi.checkRBF(txid);
        if (!mounted) return;

        setRbfStatus(result);

        if (result.replaceable && result.minNewFeeRate) {
          setNewFeeRate(result.minNewFeeRate);
        }
      } catch (err) {
        log.error('Failed to check RBF status', { error: err });
      } finally {
        if (mounted) setLoading(false);
      }
    };

    checkRBFStatus();

    return () => {
      mounted = false;
    };
  }, [txid, confirmed]);

  const handleRBF = async () => {
    if (!rbfStatus?.replaceable || !newFeeRate) return;

    try {
      setProcessing(true);
      setError(null);

      // Fetch the original transaction to preserve its label
      const originalTx = await transactionsApi.getTransaction(txid);

      // Create the RBF transaction (returns unsigned PSBT)
      const result = await bitcoinApi.createRBFTransaction(txid, {
        newFeeRate,
        walletId,
      });

      // Find the primary recipient (non-change output)
      // For RBF, we keep the same recipient as the original transaction
      const primaryOutput = result.outputs[0]; // First output is typically the recipient

      // Calculate totals from the result
      const totalInput = result.inputs.reduce((sum, inp) => sum + inp.value, 0);
      const totalOutput = result.outputs.reduce((sum, out) => sum + out.value, 0);

      // Preserve the original transaction's label (if it exists)
      const labelToUse = originalTx.label || `RBF: Fee bump from ${rbfStatus.currentFeeRate} to ${result.feeRate} sat/vB`;

      // Create a draft transaction for signing
      // isRBF: true skips UTXO locking since RBF reuses the same UTXOs
      const draft = await draftsApi.createDraft(walletId, {
        recipient: primaryOutput.address,
        amount: primaryOutput.value,
        feeRate: result.feeRate,
        selectedUtxoIds: result.inputs.map(inp => `${inp.txid}:${inp.vout}`),
        enableRBF: true,
        subtractFees: false,
        sendMax: false,
        isRBF: true, // Skip UTXO locking - RBF uses same UTXOs as original tx
        outputs: result.outputs.map(out => ({ address: out.address, amount: out.value })),
        label: labelToUse,
        memo: `Replacing transaction ${txid}`,
        psbtBase64: result.psbtBase64,
        fee: result.fee,
        totalInput,
        totalOutput,
        changeAmount: 0, // Already accounted for in outputs
        effectiveAmount: primaryOutput.value,
        inputPaths: [], // Will be populated during signing
      });

      setShowRBFModal(false);

      // Navigate to send page with the draft to continue signing
      navigate(`/wallets/${walletId}/send`, { state: { draft } });

      if (onActionComplete) {
        onActionComplete();
      }
    } catch (err: any) {
      log.error('RBF failed', { error: err });
      setError(err.message || 'Failed to create RBF transaction');
    } finally {
      setProcessing(false);
    }
  };

  const handleCPFP = async () => {
    try {
      setProcessing(true);
      setError(null);

      // For CPFP, we need to get wallet's change address
      // This is a simplified version - in production you'd want to let user choose
      const result = await bitcoinApi.createCPFPTransaction({
        parentTxid: txid,
        parentVout: 0, // Simplified - would need to select the right output
        targetFeeRate,
        recipientAddress: '', // Would need to get from wallet
        walletId,
      });

      setSuccess(
        `CPFP transaction created! Effective fee rate: ${result.effectiveFeeRate.toFixed(2)} sat/vB`
      );
      setShowCPFPModal(false);

      if (onActionComplete) {
        onActionComplete();
      }
    } catch (err: any) {
      log.error('CPFP failed', { error: err });
      setError(err.message || 'Failed to create CPFP transaction');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-sanctuary-400" />
      </div>
    );
  }

  if (confirmed) {
    return null; // No actions available for confirmed transactions
  }

  return (
    <div className="space-y-4">
      {/* Success Message */}
      {success && (
        <div className="flex items-center p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/20 text-green-800 dark:text-green-200 rounded-xl">
          <CheckCircle className="w-5 h-5 mr-3 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-800 dark:text-rose-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-3">
          Transaction Actions
        </h4>

        <div className="space-y-2">
          {/* RBF Button */}
          {!isReceived && rbfStatus?.replaceable && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowRBFModal(true)}
              className="w-full justify-start"
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Bump Fee (RBF)
              {rbfStatus.currentFeeRate && (
                <span className="ml-auto text-xs text-sanctuary-500">
                  Current: {rbfStatus.currentFeeRate} sat/vB
                </span>
              )}
            </Button>
          )}

          {/* CPFP Button */}
          {isReceived && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCPFPModal(true)}
              className="w-full justify-start"
            >
              <ArrowUpCircle className="w-4 h-4 mr-2" />
              Accelerate (CPFP)
            </Button>
          )}

          {/* Status Message */}
          {!isReceived && !rbfStatus?.replaceable && rbfStatus?.reason && (
            <div className="text-xs text-sanctuary-500 p-2 surface-secondary/30 rounded">
              {rbfStatus.reason}
            </div>
          )}
        </div>
      </div>

      {/* RBF Modal */}
      {showRBFModal && rbfStatus?.replaceable && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="surface-elevated rounded-2xl p-6 max-w-md w-full border border-sanctuary-200 dark:border-sanctuary-800">
            <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-4">
              Bump Transaction Fee (RBF)
            </h3>

            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm text-blue-900 dark:text-blue-100">
                <p className="font-medium mb-1">Replace-By-Fee (RBF)</p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Creates a new version of this transaction with a higher fee to speed up confirmation.
                </p>
              </div>

              {rbfStatus.currentFeeRate && (
                <div className="text-sm">
                  <span className="text-sanctuary-500">Current fee rate:</span>{' '}
                  <span className="font-medium">{rbfStatus.currentFeeRate} sat/vB</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                  New Fee Rate (sat/vB)
                </label>
                <input
                  type="number"
                  value={newFeeRate}
                  onChange={(e) => setNewFeeRate(parseFloat(e.target.value) || 0)}
                  min={rbfStatus.minNewFeeRate || 0.1}
                  step={0.01}
                  className="block w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none"
                />
                {rbfStatus.minNewFeeRate && (
                  <p className="text-xs text-sanctuary-500">
                    Minimum: {rbfStatus.minNewFeeRate} sat/vB
                  </p>
                )}
              </div>

              <div className="flex space-x-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setShowRBFModal(false)}
                  disabled={processing}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRBF}
                  disabled={processing || newFeeRate < (rbfStatus.minNewFeeRate || 0.1)}
                  className="flex-1"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <TrendingUp className="w-4 h-4 mr-2" />
                      Bump Fee
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CPFP Modal */}
      {showCPFPModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="surface-elevated rounded-2xl p-6 max-w-md w-full border border-sanctuary-200 dark:border-sanctuary-800">
            <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-4">
              Accelerate Transaction (CPFP)
            </h3>

            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm text-blue-900 dark:text-blue-100">
                <p className="font-medium mb-1">Child-Pays-For-Parent (CPFP)</p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Creates a new transaction spending from this one with a higher fee, incentivizing miners to confirm both.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                  Target Fee Rate (sat/vB)
                </label>
                <input
                  type="number"
                  value={targetFeeRate}
                  onChange={(e) => setTargetFeeRate(parseFloat(e.target.value) || 0)}
                  min={0.1}
                  step={0.01}
                  placeholder="e.g., 50"
                  className="block w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none"
                />
                <p className="text-xs text-sanctuary-500">
                  The effective fee rate for both transactions combined
                </p>
              </div>

              <div className="flex space-x-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setShowCPFPModal(false)}
                  disabled={processing}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCPFP}
                  disabled={processing || targetFeeRate < 1}
                  className="flex-1"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <ArrowUpCircle className="w-4 h-4 mr-2" />
                      Accelerate
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
