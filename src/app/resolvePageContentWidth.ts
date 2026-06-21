import { matchRoutes } from "react-router-dom";

import type { PageContentWidth } from "./appRouteTypes";
import { appRouteDefinitions } from "./routeDefinitions";

// Minimal route objects for matchRoutes — it only needs `path` (and an `id` to
// map the match back to its definition). matchRoutes ranks by specificity, so
// e.g. "/wallets/create" resolves to the static route, not "/wallets/:id".
const widthRouteObjects = appRouteDefinitions.map((definition) => ({
  id: definition.id,
  path: definition.path,
}));

/**
 * Resolve the layout content-width policy for the active path from the route
 * definitions. Defaults to "default" when the path matches no route or the
 * matched route declares no override.
 */
export function resolvePageContentWidth(pathname: string): PageContentWidth {
  const matches = matchRoutes(widthRouteObjects, pathname);
  if (!matches || matches.length === 0) {
    return "default";
  }

  const matchedId = matches[matches.length - 1]?.route.id;
  const matchedDefinition = appRouteDefinitions.find(
    (definition) => definition.id === matchedId,
  );

  return matchedDefinition?.contentWidth ?? "default";
}
