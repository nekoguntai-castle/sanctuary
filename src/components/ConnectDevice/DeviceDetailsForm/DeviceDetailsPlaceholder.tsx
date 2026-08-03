import { Lock } from 'lucide-react';

export function DeviceDetailsPlaceholder() {
  return (
    <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 sticky top-4">
      <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">3. Device Details</h3>
      <div className="text-center py-8 text-sanctuary-400">
        <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Select a device to continue</p>
      </div>
    </div>
  );
}
