export interface WalletRouteToken {
  routeEpoch: number;
  routeKey: string;
}

export interface WalletFetchToken extends WalletRouteToken {
  fetchGeneration: number;
}

export interface WalletRequestOwnership {
  beginFetch: (routeKey: string) => WalletFetchToken;
  captureRoute: (routeKey: string) => WalletRouteToken;
  invalidate: () => void;
  isFetchOwner: (token: WalletFetchToken) => boolean;
  isRouteOwner: (token: WalletRouteToken) => boolean;
  setRoute: (routeKey: string) => void;
}

export function createWalletRequestOwnership(initialRouteKey: string): WalletRequestOwnership {
  let routeKey = initialRouteKey;
  let routeEpoch = 0;
  let fetchGeneration = 0;

  const setRoute = (nextRouteKey: string): void => {
    if (nextRouteKey === routeKey) return;
    routeKey = nextRouteKey;
    routeEpoch += 1;
    fetchGeneration += 1;
  };

  const invalidate = (): void => {
    routeEpoch += 1;
    fetchGeneration += 1;
  };

  const captureRoute = (expectedRouteKey: string): WalletRouteToken => ({
    routeEpoch,
    routeKey: expectedRouteKey,
  });
  const beginFetch = (expectedRouteKey: string): WalletFetchToken => {
    if (expectedRouteKey === routeKey) fetchGeneration += 1;
    return { ...captureRoute(expectedRouteKey), fetchGeneration };
  };

  return {
    beginFetch,
    captureRoute,
    invalidate,
    isFetchOwner: (token) => (
      token.routeEpoch === routeEpoch
      && token.routeKey === routeKey
      && token.fetchGeneration === fetchGeneration
    ),
    isRouteOwner: (token) => (
      token.routeEpoch === routeEpoch && token.routeKey === routeKey
    ),
    setRoute,
  };
}
