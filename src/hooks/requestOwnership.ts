export interface RouteToken {
  routeEpoch: number;
  routeKey: string;
}

export interface FetchToken extends RouteToken {
  fetchGeneration: number;
}

export interface RequestOwnership {
  beginFetch: (routeKey: string) => FetchToken;
  captureRoute: (routeKey: string) => RouteToken;
  invalidate: () => void;
  isFetchOwner: (token: FetchToken) => boolean;
  isRouteOwner: (token: RouteToken) => boolean;
  setRoute: (routeKey: string) => void;
}

export function createRequestOwnership(initialRouteKey: string): RequestOwnership {
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

  const captureRoute = (expectedRouteKey: string): RouteToken => ({
    routeEpoch,
    routeKey: expectedRouteKey,
  });
  const beginFetch = (expectedRouteKey: string): FetchToken => {
    if (expectedRouteKey === routeKey) fetchGeneration += 1;
    return { ...captureRoute(expectedRouteKey), fetchGeneration };
  };

  return {
    beginFetch,
    captureRoute,
    invalidate,
    isFetchOwner: token => (
      token.routeEpoch === routeEpoch
      && token.routeKey === routeKey
      && token.fetchGeneration === fetchGeneration
    ),
    isRouteOwner: token => token.routeEpoch === routeEpoch && token.routeKey === routeKey,
    setRoute,
  };
}
