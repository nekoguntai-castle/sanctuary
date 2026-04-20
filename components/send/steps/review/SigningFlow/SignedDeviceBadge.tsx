import { Check } from 'lucide-react';

export function SignedDeviceBadge() {
  return (
    <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-500/20 rounded-lg">
      <Check className="w-3 h-3 mr-1" />
      Signed
    </span>
  );
}
