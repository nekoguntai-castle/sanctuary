import {
  Suspense,
  type ReactElement,
} from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import type {
  AppNavItem,
  AppNavSection,
  AppRouteDefinition,
} from "./appRouteTypes";
import { appRouteDefinitions } from "./routeDefinitions";

export type {
  AppNavItem,
  AppNavSection,
  AppRedirectRoute,
  AppRouteDefinition,
  AppRouteNavDefinition,
} from "./appRouteTypes";
export {
  adminNavGroup,
  appRedirectRoutes,
  appRouteDefinitions,
} from "./routeDefinitions";

export const appNavItems: AppNavItem[] = appRouteDefinitions.flatMap(
  (route) => {
    if (!route.nav) {
      return [];
    }

    return [
      {
        id: route.id,
        to: route.nav.to ?? route.path,
        label: route.nav.label,
        icon: route.nav.icon,
        section: route.nav.section,
        requiredCapabilities: route.nav.requiredCapabilities ?? route.requiredCapabilities,
      },
    ];
  },
);

export const getNavItemsBySection = (section: AppNavSection): AppNavItem[] => {
  return appNavItems.filter((item) => item.section === section);
};

export const getNavItemById = (id: string): AppNavItem | undefined => {
  return appNavItems.find((item) => item.id === id);
};

export const getRequiredNavItem = (id: string): AppNavItem => {
  const navItem = getNavItemById(id);

  if (!navItem) {
    throw new Error(`Missing nav item: ${id}`);
  }

  return navItem;
};

export const renderAppRouteElement = (
  route: AppRouteDefinition,
): ReactElement => {
  const Page = route.component;

  return (
    <ErrorBoundary>
      <Suspense fallback={route.fallback}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  );
};
