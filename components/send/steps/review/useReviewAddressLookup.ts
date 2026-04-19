import { useEffect, useMemo, useState } from 'react';
import type { TransactionState } from '../../../../contexts/send/types';
import type { TransactionData } from '../../../../hooks/send/types';
import { lookupAddresses, type AddressLookupResult } from '../../../../src/api/bitcoin';
import { createLogger } from '../../../../utils/logger';
import { getLookupAddressesForReview } from './reviewStepData';

const log = createLogger('ReviewStep');

export function useReviewAddressLookup(
  outputs: TransactionState['outputs'],
  txData?: TransactionData | null
): Record<string, AddressLookupResult> {
  const [addressLookup, setAddressLookup] = useState<Record<string, AddressLookupResult>>({});
  const addresses = useMemo(
    () => getLookupAddressesForReview(outputs, txData),
    [outputs, txData?.changeAddress, txData?.decoyOutputs]
  );

  useEffect(() => {
    if (addresses.length === 0) return;

    lookupAddresses(addresses)
      .then(response => {
        setAddressLookup(response.lookup);
      })
      .catch(error => {
        log.warn('Failed to lookup addresses', { error: String(error) });
      });
  }, [addresses]);

  return addressLookup;
}
