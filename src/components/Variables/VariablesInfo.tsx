import { Info } from 'lucide-react';

export function VariablesInfo() {
  return (
    <div className="surface-secondary rounded-lg p-4 border border-sanctuary-200 dark:border-sanctuary-700">
      <div className="flex items-start space-x-3">
        <Info className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            About These Variables
          </h4>
          <div className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-2">
            <p>
              <strong>Confirmation Threshold:</strong> Controls when UTXOs become spendable. A higher value increases
              security but reduces liquidity. Common values: 1-3 for everyday use, 6 for high-value transactions.
            </p>
            <p>
              <strong>Deep Confirmation Threshold:</strong> Determines when transactions are shown as "fully confirmed"
              in the UI. Typically set to 3-6, representing 30-60 minutes of Bitcoin mining.
            </p>
            <p>
              <strong>Dust Threshold:</strong> The standard Bitcoin network dust limit is 546 satoshis for legacy
              outputs. Lowering this risks transactions being rejected by nodes. Only change if you understand the
              implications.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
