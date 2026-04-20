import { Variable } from 'lucide-react';
import { SaveFeedback } from './SaveFeedback';
import { ThresholdField } from './ThresholdField';
import type { VariablesController } from './types';

interface ThresholdsCardProps {
  controller: VariablesController;
}

export function ThresholdsCard({ controller }: ThresholdsCardProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Variable className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Confirmation Thresholds
          </h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <ThresholdField
          label="Confirmation Threshold"
          description="Number of confirmations required before UTXOs can be spent. UTXOs with fewer confirmations will not be available for transaction building."
          value={controller.confirmationThreshold}
          max={100}
          unit="confirmations"
          onChange={controller.handleConfirmationThresholdChange}
        />

        <ThresholdField
          label="Deep Confirmation Threshold"
          description={'Number of confirmations for a transaction to be considered "deeply confirmed" and final. Affects UI status display.'}
          value={controller.deepConfirmationThreshold}
          max={100}
          unit="confirmations"
          onChange={controller.handleDeepConfirmationThresholdChange}
        />

        <ThresholdField
          label="Dust Threshold"
          description={'Minimum output value in satoshis. Outputs below this are considered "dust" and won\'t be created or relayed by the network.'}
          value={controller.dustThreshold}
          max={10000}
          unit="satoshis"
          onChange={controller.handleDustThresholdChange}
        />

        <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
          <button
            onClick={controller.handleSave}
            disabled={controller.isSaving}
            className={`px-4 py-2 bg-primary-600 dark:bg-primary-400 hover:bg-primary-700 dark:hover:bg-primary-300 text-white dark:text-primary-950 rounded-lg font-medium transition-colors ${
              controller.isSaving ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {controller.isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        <SaveFeedback saveSuccess={controller.saveSuccess} displayError={controller.displayError} />
      </div>
    </div>
  );
}
