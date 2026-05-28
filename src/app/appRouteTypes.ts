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

export interface AppRouteDefinition {
  id: string;
  path: string;
  component: LazyRouteComponent;
  fallback: ReactNode;
  requiredCapabilities?: readonly AppCapability[];
  nav?: AppRouteNavDefinition;
}

export interface AppRedirectRoute {
  path: string;
  to: string;
  replace?: boolean;
}
