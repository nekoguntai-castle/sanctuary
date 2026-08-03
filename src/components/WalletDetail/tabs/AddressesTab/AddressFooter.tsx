import { Button } from '../../../ui/Button';

type AddressFooterProps = {
  addressCount: number;
  totalAddresses: number;
  hasMoreAddresses: boolean;
  loadingAddresses: boolean;
  onLoadMoreAddresses: () => void;
};

export function AddressFooter({
  addressCount,
  totalAddresses,
  hasMoreAddresses,
  loadingAddresses,
  onLoadMoreAddresses,
}: AddressFooterProps) {
  if (addressCount === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between text-sm text-sanctuary-500">
      <span>
        Showing {addressCount} of {totalAddresses} addresses
      </span>
      <div className="flex items-center gap-2">
        {hasMoreAddresses ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMoreAddresses}
            isLoading={loadingAddresses}
          >
            Load More
          </Button>
        ) : (
          <span className="text-xs text-sanctuary-400">All addresses loaded</span>
        )}
      </div>
    </div>
  );
}
