import { MapPin, Plus } from 'lucide-react';
import { Button } from '../../../ui/Button';

type EmptyAddressesStateProps = {
  descriptor: string | null;
  loadingAddresses: boolean;
  onGenerateMoreAddresses: () => void;
};

export function EmptyAddressesState({
  descriptor,
  loadingAddresses,
  onGenerateMoreAddresses,
}: EmptyAddressesStateProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
      <MapPin className="w-12 h-12 mx-auto text-sanctuary-300 dark:text-sanctuary-600 mb-4" />
      <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Addresses Available</h3>
      <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 mb-4 max-w-md mx-auto">
        {!descriptor
          ? "This wallet doesn't have a descriptor. Please link a hardware device with an xpub to generate addresses."
          : 'No addresses have been generated yet. Click below to generate addresses.'}
      </p>
      {descriptor && (
        <Button variant="primary" onClick={onGenerateMoreAddresses} isLoading={loadingAddresses}>
          <Plus className="w-4 h-4 mr-2" />
          Generate Addresses
        </Button>
      )}
    </div>
  );
}
