import { MapPin, Plus } from 'lucide-react';
import { Button } from '../../../ui/Button';

type EmptyAddressesStateProps = {
  descriptor: string | null;
  /** Addresses the summary counts; above zero means the list was withheld, not absent. */
  knownAddressCount: number;
  loadingAddresses: boolean;
  onGenerateMoreAddresses: () => void;
};

function emptyStateCopy(descriptor: string | null, knownAddressCount: number) {
  if (knownAddressCount > 0) {
    // The list request failed while the summary still counts addresses — e.g. the
    // wallet-safety display gate returns 403 and redacts the descriptor.
    return {
      title: 'Addresses Unavailable',
      body: `This wallet has ${knownAddressCount} addresses, but they can't be shown right now. Address display can be restricted by hardware wallet safety checks for this wallet's devices. Try again later.`,
    };
  }
  return {
    title: 'No Addresses Available',
    body: !descriptor
      ? "This wallet doesn't have a descriptor. Please link a hardware device with an xpub to generate addresses."
      : 'No addresses have been generated yet. Click below to generate addresses.',
  };
}

export function EmptyAddressesState({
  descriptor,
  knownAddressCount,
  loadingAddresses,
  onGenerateMoreAddresses,
}: EmptyAddressesStateProps) {
  const { title, body } = emptyStateCopy(descriptor, knownAddressCount);
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
      <MapPin className="w-12 h-12 mx-auto text-sanctuary-300 dark:text-sanctuary-600 mb-4" />
      <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">{title}</h3>
      <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 mb-4 max-w-md mx-auto">
        {body}
      </p>
      {descriptor && knownAddressCount === 0 && (
        <Button variant="primary" onClick={onGenerateMoreAddresses} isLoading={loadingAddresses}>
          <Plus className="w-4 h-4 mr-2" />
          Generate Addresses
        </Button>
      )}
    </div>
  );
}
