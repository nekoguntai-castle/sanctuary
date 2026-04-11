import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactElement, type ReactNode } from 'react';
import {
  Activity,
  Brain,
  Cog,
  Cpu,
  Database,
  FileText,
  LayoutDashboard,
  Server,
  Settings,
  Shield,
  ToggleLeft,
  UserCircle,
  Users,
  Wallet as WalletIcon,
} from 'lucide-react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { DashboardSkeleton, ListSkeleton, SettingsSkeleton, WalletDetailSkeleton } from '../../components/ui/Skeleton';
import type { AppCapability } from './capabilities';

type LazyRouteComponent = LazyExoticComponent<ComponentType<any>>;
type NavIcon = ComponentType<{ className?: string }>;

export type AppNavSection = 'primary' | 'wallets' | 'hardware' | 'system' | 'admin';

export interface AppNavItem {
  id: string;
  to: string;
  label: string;
  icon: NavIcon;
  section: AppNavSection;
  requiredCapabilities?: readonly AppCapability[];
}

interface AppRouteNavDefinition {
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
  nav?: AppRouteNavDefinition;
}

export interface AppRedirectRoute {
  path: string;
  to: string;
  replace?: boolean;
}

export const adminNavGroup = {
  id: 'admin',
  to: '/admin',
  label: 'Administration',
  icon: Shield,
} satisfies Omit<AppNavItem, 'section'>;

const Dashboard = lazy(async () => ({ default: (await import('../../components/Dashboard')).Dashboard }));
const WalletList = lazy(async () => ({ default: (await import('../../components/WalletList')).WalletList }));
const WalletDetail = lazy(async () => ({ default: (await import('../../components/WalletDetail')).WalletDetail }));
const SendTransactionPage = lazy(async () => ({ default: (await import('../../components/send')).SendTransactionPage }));
const CreateWallet = lazy(async () => ({ default: (await import('../../components/CreateWallet')).CreateWallet }));
const ImportWallet = lazy(async () => ({ default: (await import('../../components/ImportWallet')).ImportWallet }));
const DeviceList = lazy(async () => ({ default: (await import('../../components/DeviceList')).DeviceList }));
const DeviceDetail = lazy(async () => ({ default: (await import('../../components/DeviceDetail')).DeviceDetail }));
const ConnectDevice = lazy(async () => ({ default: (await import('../../components/ConnectDevice')).ConnectDevice }));
const SettingsPage = lazy(async () => ({ default: (await import('../../components/Settings')).Settings }));
const Account = lazy(async () => ({ default: (await import('../../components/Account')).Account }));
const NodeConfig = lazy(async () => ({ default: (await import('../../components/NodeConfig')).NodeConfig }));
const UsersGroups = lazy(async () => ({ default: (await import('../../components/UsersGroups')).UsersGroups }));
const SystemSettings = lazy(async () => ({ default: (await import('../../components/SystemSettings')).SystemSettings }));
const Variables = lazy(async () => ({ default: (await import('../../components/Variables')).Variables }));
const BackupRestore = lazy(async () => ({ default: (await import('../../components/BackupRestore')).BackupRestore }));
const AuditLogs = lazy(async () => ({ default: (await import('../../components/AuditLogs')).AuditLogs }));
const AISettings = lazy(() => import('../../components/AISettings'));
const Monitoring = lazy(() => import('../../components/Monitoring'));
const FeatureFlags = lazy(async () => ({ default: (await import('../../components/FeatureFlags')).FeatureFlags }));
const Intelligence = lazy(async () => ({ default: (await import('../../components/Intelligence')).Intelligence }));

export const appRouteDefinitions: AppRouteDefinition[] = [
  {
    id: 'dashboard',
    path: '/',
    component: Dashboard,
    fallback: <DashboardSkeleton />,
    nav: {
      label: 'Dashboard',
      icon: LayoutDashboard,
      section: 'primary',
    },
  },
  {
    id: 'wallets',
    path: '/wallets',
    component: WalletList,
    fallback: <ListSkeleton />,
    nav: {
      label: 'Wallets',
      icon: WalletIcon,
      section: 'wallets',
    },
  },
  {
    id: 'wallet-detail',
    path: '/wallets/:id',
    component: WalletDetail,
    fallback: <WalletDetailSkeleton />,
  },
  {
    id: 'wallet-create',
    path: '/wallets/create',
    component: CreateWallet,
    fallback: <SettingsSkeleton />,
  },
  {
    id: 'wallet-import',
    path: '/wallets/import',
    component: ImportWallet,
    fallback: <SettingsSkeleton />,
  },
  {
    id: 'wallet-send',
    path: '/wallets/:id/send',
    component: SendTransactionPage,
    fallback: <SettingsSkeleton />,
  },
  {
    id: 'devices',
    path: '/devices',
    component: DeviceList,
    fallback: <ListSkeleton />,
    nav: {
      label: 'Devices',
      icon: Cpu,
      section: 'hardware',
    },
  },
  {
    id: 'device-connect',
    path: '/devices/connect',
    component: ConnectDevice,
    fallback: <SettingsSkeleton />,
  },
  {
    id: 'device-detail',
    path: '/devices/:id',
    component: DeviceDetail,
    fallback: <WalletDetailSkeleton />,
  },
  {
    id: 'account',
    path: '/account',
    component: Account,
    fallback: <SettingsSkeleton />,
    nav: {
      label: 'Account',
      icon: UserCircle,
      section: 'system',
    },
  },
  {
    id: 'settings',
    path: '/settings',
    component: SettingsPage,
    fallback: <SettingsSkeleton />,
    nav: {
      label: 'Settings',
      icon: Settings,
      section: 'system',
    },
  },
  {
    id: 'intelligence',
    path: '/intelligence',
    component: Intelligence,
    fallback: <DashboardSkeleton />,
    nav: {
      label: 'Intelligence',
      icon: Brain,
      section: 'primary',
      requiredCapabilities: ['intelligence'],
    },
  },
  {
    id: 'admin-node-config',
    path: '/admin/node-config',
    component: NodeConfig,
    fallback: <SettingsSkeleton />,
    nav: {
      label: 'Node Config',
      icon: Server,
      section: 'admin',
    },
  },
  {
    id: 'admin-settings',
    path: '/admin/settings',
    component: SystemSettings,
    fallback: <SettingsSkeleton />,
    nav: {
      label: 'System Settings',
      icon: Cog,
      section: 'admin',
    },
  },
  {
    id: 'admin-variables',
    path: '/admin/variables',
    component: Variables,
    fallback: <SettingsSkeleton />,
    nav: {
      label: 'Variables',
      icon: Cog,
      section: 'admin',
    },
  },
  {
    id: 'admin-users-groups',
    path: '/admin/users-groups',
    component: UsersGroups,
    fallback: <ListSkeleton />,
    nav: {
      label: 'Users & Groups',
      icon: Users,
      section: 'admin',
    },
  },
  {
    id: 'admin-backup',
    path: '/admin/backup',
    component: BackupRestore,
    fallback: <SettingsSkeleton />,
    nav: {
      label: 'Backup & Restore',
      icon: Database,
      section: 'admin',
    },
  },
  {
    id: 'admin-audit-logs',
    path: '/admin/audit-logs',
    component: AuditLogs,
    fallback: <ListSkeleton />,
    nav: {
      label: 'Audit Logs',
      icon: FileText,
      section: 'admin',
    },
  },
  {
    id: 'admin-ai',
    path: '/admin/ai',
    component: AISettings,
    fallback: <SettingsSkeleton />,
    nav: {
      label: 'AI Assistant',
      icon: Brain,
      section: 'admin',
    },
  },
  {
    id: 'admin-monitoring',
    path: '/admin/monitoring',
    component: Monitoring,
    fallback: <DashboardSkeleton />,
    nav: {
      label: 'Monitoring',
      icon: Activity,
      section: 'admin',
    },
  },
  {
    id: 'admin-feature-flags',
    path: '/admin/feature-flags',
    component: FeatureFlags,
    fallback: <ListSkeleton />,
    nav: {
      label: 'Feature Flags',
      icon: ToggleLeft,
      section: 'admin',
    },
  },
];

export const appRedirectRoutes: AppRedirectRoute[] = [
  { path: '/admin', to: '/admin/settings', replace: true },
  { path: '*', to: '/', replace: true },
];

export const appNavItems: AppNavItem[] = appRouteDefinitions.flatMap((route) => {
  if (!route.nav) {
    return [];
  }

  return [{
    id: route.id,
    to: route.nav.to ?? route.path,
    label: route.nav.label,
    icon: route.nav.icon,
    section: route.nav.section,
    requiredCapabilities: route.nav.requiredCapabilities,
  }];
});

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

export const renderAppRouteElement = (route: AppRouteDefinition): ReactElement => {
  const Page = route.component;

  return (
    <ErrorBoundary>
      <Suspense fallback={route.fallback}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  );
};
