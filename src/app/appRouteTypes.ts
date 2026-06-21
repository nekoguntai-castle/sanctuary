import type {
  ComponentType,
  LazyExoticComponent,
  ReactNode,
} from "react";
import type { AppCapability } from "./capabilities";

type LazyRouteComponent = LazyExoticComponent<ComponentType<any>>;
type NavIcon = ComponentType<{ className?: string }>;

export type AppNavSection =
  | "primary"
  | "wallets"
  | "hardware"
  | "system"
  | "admin";

export interface AppNavItem {
  id: string;
  to: string;
  label: string;
  icon: NavIcon;
  section: AppNavSection;
  requiredCapabilities?: readonly AppCapability[];
}

export interface AppRouteNavDefinition {
  label: string;
  icon: NavIcon;
  section: AppNavSection;
  to?: string;
  requiredCapabilities?: readonly AppCapability[];
}

/**
 * Page content-width policy for the main layout container.
 * - "default": the standard max-w-7xl cap.
 * - "wide": keeps max-w-7xl up to xl, then widens at the 2xl breakpoint.
 * - "full": no max-width cap (content spans the available width).
 */
export type PageContentWidth = "default" | "wide" | "full";

export interface AppRouteDefinition {
  id: string;
  path: string;
  component: LazyRouteComponent;
  fallback: ReactNode;
  requiredCapabilities?: readonly AppCapability[];
  nav?: AppRouteNavDefinition;
  /** Optional override of the layout content width for this route. */
  contentWidth?: PageContentWidth;
}

export interface AppRedirectRoute {
  path: string;
  to: string;
  replace?: boolean;
}
