import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from './ui/Button';
import { ArrowLeft, Plus, X, Users, TrendingDown, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import * as bitcoinApi from '../src/api/bitcoin';
import { useCurrency } from '../contexts/CurrencyContext';
import { createLogger } from '../utils/logger';

const log = createLogger('BatchSend');

interface Recipient {
  id: string;
  address: string;
  amount: string;
  label?: string;
}

export function removeRecipientById(recipients: Recipient[], id: string): Recipient[] {
  return recipients.length > 1
    ? recipients.filter((recipient) => recipient.id !== id)
    : recipients;
}

export const BatchSend: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { format, getFiatValue, currencySymbol } = useCurrency();

  const [recipients, setRecipients] = useState<Recipient[]>([
    { id: crypto.randomUUID(), address: '', amount: '', label: '' },
  ]);
  const [feeRate, setFeeRate] = useState<number>(10);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<bitcoinApi.BatchTransactionResponse | null>(null);

  const addRecipient = () => {
    setRecipients([
      ...recipients,
      { id: crypto.randomUUID(), address: '', amount: '', label: '' },
    ]);
  };

  const removeRecipient = (id: string) => {
    setRecipients((currentRecipients) => removeRecipientById(currentRecipients, id));
  };

  const updateRecipient = (id: string, field: keyof Recipient, value: string) => {
    setRecipients(
      recipients.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const calculateTotal = () => {
    return recipients.reduce((sum, r) => sum + (parseInt(r.amount, 10) || 0), 0);
  };

  const calculateIndividualFees = () => {
    // Approximate: each individual tx would be ~150 vB * feeRate
    return recipients.length * 150 * feeRate;
  };

  const handleCreate = async () => {
    if (!id) return;

    try {
      setProcessing(true);
      setError(null);

      // Validate recipients
      const validRecipients = recipients.filter(
        (r) => r.address && r.amount && parseInt(r.amount, 10) > 0
      );

      if (validRecipients.length === 0) {
        setError('Please add at least one valid recipient');
        return;
      }

      // Check for invalid addresses
      for (const recipient of validRecipients) {
        if (recipient.address.length < 10) {
          setError(`Invalid address: ${recipient.address}`);
          return;
        }
      }

      const batchResult = await bitcoinApi.createBatchTransaction({
        recipients: validRecipients.map((r) => ({
          address: r.address,
          amount: parseInt(r.amount, 10),
          label: r.label,
        })),
        feeRate,
        walletId: id,
      });

      setResult(batchResult);
    } catch (err: any) {
      log.error('Batch transaction failed', { error: err });
      setError(err.message || 'Failed to create batch transaction');
    } finally {
      setProcessing(false);
    }
  };

  const totalAmount = calculateTotal();
  const estimatedIndividualFees = calculateIndividualFees();

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in pb-12">
      <button
        onClick={() => navigate(`/wallets/${id}`)}
        className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Wallet
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">
            Batch Send
          </h1>
          <p className="text-sm text-sanctuary-500 mt-1">
            Send to multiple recipients in a single transaction
          </p>
        </div>
        <div className="text-center">
          <Users className="w-8 h-8 mx-auto mb-1 text-sanctuary-400" />
          <div className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {recipients.length}
          </div>
          <div className="text-xs text-sanctuary-500">Recipients</div>
        </div>
      </div>

      {/* Benefits Banner */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-500/20">
        <div className="flex items-start space-x-3">
          <TrendingDown className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100 text-sm">
              Save on Transaction Fees
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Batch transactions combine multiple payments into one, significantly reducing fees compared to sending individually.
            </p>
          </div>
        </div>
      </div>

      {/* Recipients List */}
      <div className="space-y-4">
        {recipients.map((recipient, index) => (
          <div
            key={recipient.id}
            className="surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 surface-secondary rounded-full flex items-center justify-center text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400">
                  {index + 1}
                </div>
                <input
                  type="text"
                  value={recipient.label}
                  onChange={(e) => updateRecipient(recipient.id, 'label', e.target.value)}
                  placeholder="Label (optional)"
                  className="text-sm px-2 py-1 rounded border border-transparent hover:border-sanctuary-300 dark:hover:border-sanctuary-700 bg-transparent focus:border-sanctuary-500 focus:ring-1 focus:ring-sanctuary-500 outline-none"
                />
              </div>
              {recipients.length > 1 && (
                <button
                  onClick={() => removeRecipient(recipient.id)}
                  className="text-sanctuary-400 hover:text-rose-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  value={recipient.address}
                  onChange={(e) => updateRecipient(recipient.id, 'address', e.target.value)}
                  placeholder="bc1q..."
                  className="block w-full px-3 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-muted text-sm focus:ring-2 focus:ring-sanctuary-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                  Amount (sats)
                </label>
                <input
                  type="number"
                  value={recipient.amount}
                  onChange={(e) => updateRecipient(recipient.id, 'amount', e.target.value)}
                  placeholder="0"
                  className="block w-full px-3 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-muted text-sm focus:ring-2 focus:ring-sanctuary-500 focus:outline-none"
                />
                {recipient.amount && parseInt(recipient.amount, 10) > 0 && (
                  <p className="text-xs text-sanctuary-500 mt-1">
                    ≈ {currencySymbol}
                    {getFiatValue(parseInt(recipient.amount, 10)).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}

        <Button
          variant="secondary"
          onClick={addRecipient}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Recipient
        </Button>
      </div>

      {/* Fee Selection */}
      <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-4">
          Network Fee
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
              Fee Rate (sat/vB)
            </label>
            <input
              type="number"
              value={feeRate}
              onChange={(e) => setFeeRate(parseFloat(e.target.value) || 0)}
              min={0.1}
              step={0.01}
              className="block w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none"
            />
          </div>

          {/* Fee Comparison */}
          <div className="p-3 surface-secondary/30 rounded-lg">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-sanctuary-600 dark:text-sanctuary-400">
                Individual transactions:
              </span>
              <span className="font-medium">~{format(estimatedIndividualFees)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-sanctuary-600 dark:text-sanctuary-400">
                Batch transaction:
              </span>
              <span className="font-medium text-green-600 dark:text-green-400">
                ~{format(Math.ceil(estimatedIndividualFees * 0.4))}
              </span>
            </div>
            <div className="pt-2 mt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
              <div className="flex items-center justify-between text-sm font-medium">
                <span className="text-green-600 dark:text-green-400">Estimated savings:</span>
                <span className="text-green-600 dark:text-green-400">
                  ~{format(Math.ceil(estimatedIndividualFees * 0.6))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-4">
          Summary
        </h3>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-sanctuary-600 dark:text-sanctuary-400">Recipients</span>
            <span className="font-medium">{recipients.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-sanctuary-600 dark:text-sanctuary-400">Total Amount</span>
            <span className="font-medium">{format(totalAmount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-sanctuary-600 dark:text-sanctuary-400">Est. Fee</span>
            <span className="font-medium">
              ~{format(Math.ceil(estimatedIndividualFees * 0.4))}
            </span>
          </div>
          <div className="pt-2 mt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
            <div className="flex justify-between">
              <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Total Cost
              </span>
              <span className="font-bold text-sanctuary-900 dark:text-sanctuary-100">
                {format(totalAmount + Math.ceil(estimatedIndividualFees * 0.4))}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-800 dark:text-rose-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Success Display */}
      {result && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/20 rounded-xl">
          <div className="flex items-start space-x-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-green-900 dark:text-green-100 text-sm mb-2">
                Batch Transaction Created Successfully!
              </p>
              <div className="space-y-1 text-xs text-green-700 dark:text-green-300">
                <div className="flex justify-between">
                  <span>Recipients:</span>
                  <span className="font-medium">{result.recipientCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Amount:</span>
                  <span className="font-medium">{format(result.totalOutput)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Fee:</span>
                  <span className="font-medium">{format(result.fee)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Saved:</span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {format(result.savedFees)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 surface-elevated border-t border-sanctuary-200 dark:border-sanctuary-800 md:static md:bg-transparent md:border-0 md:p-0">
        <Button
          size="lg"
          className="w-full shadow-lg shadow-sanctuary-900/10 dark:shadow-black/20"
          disabled={processing || totalAmount === 0}
          onClick={handleCreate}
        >
          {processing ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Creating Batch Transaction...
            </>
          ) : (
            <>
              <Users className="w-5 h-5 mr-2" />
              Create Batch Transaction
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
