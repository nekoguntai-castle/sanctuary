import { useEffect, useRef } from 'react';
import {
  createRequestOwnership,
  type RequestOwnership,
} from '../../../hooks/requestOwnership';

/**
 * Keeps Wallet Detail sub-hooks on the shared route-ownership contract.
 * setRoute is intentionally synchronous so promises from the previous render
 * lose ownership before layout/effect cleanup runs.
 */
export function useWalletRouteOwnership(routeKey: string): RequestOwnership {
  const ownershipRef = useRef<RequestOwnership | null>(null);
  if (!ownershipRef.current) {
    ownershipRef.current = createRequestOwnership(routeKey);
  }

  const ownership = ownershipRef.current;
  ownership.setRoute(routeKey);
  useEffect(() => () => ownership.invalidate(), [ownership]);
  return ownership;
}
