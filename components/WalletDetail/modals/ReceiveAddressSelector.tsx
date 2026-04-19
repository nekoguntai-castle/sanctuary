import React from 'react';
import type { Address } from '../../../types';

interface ReceiveAddressSelectorProps {
  selectedAddress: Address | undefined;
  unusedReceiveAddresses: Address[];
  onSelectAddress: (addressId: string | null) => void;
}

export const ReceiveAddressSelector: React.FC<ReceiveAddressSelectorProps> = ({
  selectedAddress,
  unusedReceiveAddresses,
  onSelectAddress,
}) => {
  if (!selectedAddress || unusedReceiveAddresses.length <= 1) return null;

  return (
    <div className="w-full mb-4">
      <label className="block text-xs font-medium text-sanctuary-500 mb-1">
        Select Address ({unusedReceiveAddresses.length} unused)
      </label>
      <select
        value={selectedAddress.id}
        onChange={(event) => onSelectAddress(event.target.value || null)}
        className="w-full px-3 py-2 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 surface-muted text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
      >
        {unusedReceiveAddresses.map(address => (
          <option key={address.id} value={address.id}>
            #{address.index} - {address.address.slice(0, 12)}...{address.address.slice(-8)}
          </option>
        ))}
      </select>
    </div>
  );
};
