import { AlertCircle, Zap } from 'lucide-react';

export function AutopilotLoadingCard() {
  return (
    <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="animate-pulse flex space-x-4">
        <div className="h-5 w-5 bg-sanctuary-200 dark:bg-sanctuary-700 rounded"></div>
        <div className="flex-1 space-y-4 py-1">
          <div className="h-4 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-3/4"></div>
          <div className="h-4 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-1/2"></div>
        </div>
      </div>
    </div>
  );
}

export function FeatureUnavailableCard() {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-sanctuary-400">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Autopilot</h3>
        </div>
      </div>
      <div className="p-6">
        <div className="p-4 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-sanctuary-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Feature not available</p>
              <p className="text-xs text-sanctuary-500 mt-1">
                Treasury Autopilot is not enabled on this server.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
