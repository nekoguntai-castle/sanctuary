import React, { useState, useEffect, useRef } from 'react';
import { Check, AlertCircle, AlertTriangle, Variable, Info } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { useLoadingState } from '../hooks/useLoadingState';

export const Variables: React.FC = () => {
  const [confirmationThreshold, setConfirmationThreshold] = useState(1);
  const [deepConfirmationThreshold, setDeepConfirmationThreshold] = useState(3);
  const [dustThreshold, setDustThreshold] = useState(546);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Loading states using hook
  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: isSaving, error: saveError, execute: runSave } = useLoadingState();

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    runLoad(async () => {
      const settings = await adminApi.getSystemSettings();
      setConfirmationThreshold(settings.confirmationThreshold ?? 1);
      setDeepConfirmationThreshold(settings.deepConfirmationThreshold ?? 3);
      setDustThreshold(settings.dustThreshold ?? 546);
    });
  }, []);

  const handleSave = async () => {
    // Validate: deep confirmation must be >= confirmation threshold
    if (deepConfirmationThreshold < confirmationThreshold) {
      setValidationError('Deep confirmation threshold must be greater than or equal to confirmation threshold');
      return;
    }
    setValidationError(null);

    const result = await runSave(async () => {
      await adminApi.updateSystemSettings({
        confirmationThreshold,
        deepConfirmationThreshold,
        dustThreshold,
      });
    });

    if (result !== null) {
      setSaveSuccess(true);
      // Clear any existing timeout and set new one
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  // Combined error display
  const displayError = validationError || saveError;

  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading variables...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">System Variables</h2>
        <p className="text-sanctuary-500">Configure system-wide variables for Sanctuary</p>
      </div>

      {/* Warning Banner */}
      <div className="flex items-start space-x-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Advanced Settings
          </h4>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            These values affect how Sanctuary handles Bitcoin transactions. Do not change them unless you understand the implications.
          </p>
        </div>
      </div>

      {/* Confirmation Thresholds */}
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
              <Variable className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Confirmation Thresholds</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Confirmation Threshold */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Confirmation Threshold
            </label>
            <p className="text-sm text-sanctuary-500">
              Number of confirmations required before UTXOs can be spent. UTXOs with fewer confirmations will not be available for transaction building.
            </p>
            <div className="flex items-center space-x-3">
              <input
                type="number"
                min="1"
                max="100"
                value={confirmationThreshold}
                onChange={(e) => setConfirmationThreshold(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-24 px-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <span className="text-sm text-sanctuary-500">confirmations</span>
            </div>
          </div>

          {/* Deep Confirmation Threshold */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Deep Confirmation Threshold
            </label>
            <p className="text-sm text-sanctuary-500">
              Number of confirmations for a transaction to be considered "deeply confirmed" and final. Affects UI status display.
            </p>
            <div className="flex items-center space-x-3">
              <input
                type="number"
                min="1"
                max="100"
                value={deepConfirmationThreshold}
                onChange={(e) => setDeepConfirmationThreshold(parseInt(e.target.value, 10) || 1)}
                className="w-24 px-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <span className="text-sm text-sanctuary-500">confirmations</span>
            </div>
          </div>

          {/* Dust Threshold */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Dust Threshold
            </label>
            <p className="text-sm text-sanctuary-500">
              Minimum output value in satoshis. Outputs below this are considered "dust" and won't be created or relayed by the network.
            </p>
            <div className="flex items-center space-x-3">
              <input
                type="number"
                min="1"
                max="10000"
                value={dustThreshold}
                onChange={(e) => setDustThreshold(Math.max(1, parseInt(e.target.value, 10) || 546))}
                className="w-24 px-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <span className="text-sm text-sanctuary-500">satoshis</span>
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={`px-4 py-2 bg-primary-600 dark:bg-primary-400 hover:bg-primary-700 dark:hover:bg-primary-300 text-white dark:text-primary-950 rounded-lg font-medium transition-colors ${
                isSaving ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          {/* Save Feedback */}
          {saveSuccess && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">Settings saved successfully</span>
            </div>
          )}

          {displayError && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{displayError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="surface-secondary rounded-lg p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              About These Variables
            </h4>
            <div className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-2">
              <p>
                <strong>Confirmation Threshold:</strong> Controls when UTXOs become spendable. A higher value increases security but reduces liquidity. Common values: 1-3 for everyday use, 6 for high-value transactions.
              </p>
              <p>
                <strong>Deep Confirmation Threshold:</strong> Determines when transactions are shown as "fully confirmed" in the UI. Typically set to 3-6, representing 30-60 minutes of Bitcoin mining.
              </p>
              <p>
                <strong>Dust Threshold:</strong> The standard Bitcoin network dust limit is 546 satoshis for legacy outputs. Lowering this risks transactions being rejected by nodes. Only change if you understand the implications.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
