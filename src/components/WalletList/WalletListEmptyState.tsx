import { Plus, Upload, Wallet as WalletIcon } from 'lucide-react';
import { Button } from '../ui/Button';

export function WalletListEmptyState({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  return (
    <div className="space-y-6 animate-fade-in pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Wallet Overview</h2>
          <p className="text-sanctuary-500">Manage your wallets and spending accounts</p>
        </div>
      </div>

      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full surface-secondary mb-4">
          <WalletIcon className="w-8 h-8 text-sanctuary-400" />
        </div>
        <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Wallets Yet</h3>
        <p className="text-sanctuary-500 mb-6 max-w-md mx-auto">
          Create your first wallet to start managing your Bitcoin. Connect your hardware devices and build single-sig or multi-sig wallets with full self-custody.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={onCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Create Wallet
          </Button>
          <Button variant="secondary" onClick={onImport}>
            <Upload className="w-4 h-4 mr-2" />
            Import Wallet
          </Button>
        </div>
      </div>
    </div>
  );
}
