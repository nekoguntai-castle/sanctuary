import { lazy } from "react";

export const Dashboard = lazy(async () => ({
  default: (await import("../../components/Dashboard")).Dashboard,
}));
export const WalletList = lazy(async () => ({
  default: (await import("../../components/WalletList")).WalletList,
}));
export const WalletDetail = lazy(async () => ({
  default: (await import("../../components/WalletDetail")).WalletDetail,
}));
export const ConsoleResults = lazy(async () => ({
  default: (await import("../../components/ConsoleResults")).ConsoleResults,
}));
export const SendTransactionPage = lazy(async () => ({
  default: (await import("../../components/send")).SendTransactionPage,
}));
export const CreateWallet = lazy(async () => ({
  default: (await import("../../components/CreateWallet")).CreateWallet,
}));
export const ImportWallet = lazy(async () => ({
  default: (await import("../../components/ImportWallet")).ImportWallet,
}));
export const DeviceList = lazy(async () => ({
  default: (await import("../../components/DeviceList")).DeviceList,
}));
export const DeviceDetail = lazy(async () => ({
  default: (await import("../../components/DeviceDetail")).DeviceDetail,
}));
export const ConnectDevice = lazy(async () => ({
  default: (await import("../../components/ConnectDevice")).ConnectDevice,
}));
export const SettingsPage = lazy(async () => ({
  default: (await import("../../components/Settings")).Settings,
}));
export const Account = lazy(async () => ({
  default: (await import("../../components/Account")).Account,
}));
export const NodeConfig = lazy(async () => ({
  default: (await import("../../components/NodeConfig")).NodeConfig,
}));
export const UsersGroups = lazy(async () => ({
  default: (await import("../../components/UsersGroups")).UsersGroups,
}));
export const SystemSettings = lazy(async () => ({
  default: (await import("../../components/SystemSettings")).SystemSettings,
}));
export const Variables = lazy(async () => ({
  default: (await import("../../components/Variables")).Variables,
}));
export const BackupRestore = lazy(async () => ({
  default: (await import("../../components/BackupRestore")).BackupRestore,
}));
export const AuditLogs = lazy(async () => ({
  default: (await import("../../components/AuditLogs")).AuditLogs,
}));
export const AISettings = lazy(() => import("../../components/AISettings"));
export const Monitoring = lazy(() => import("../../components/Monitoring"));
export const FeatureFlags = lazy(async () => ({
  default: (await import("../../components/FeatureFlags")).FeatureFlags,
}));
export const Intelligence = lazy(async () => ({
  default: (await import("../../components/Intelligence")).Intelligence,
}));
export const AgentWalletDashboard = lazy(async () => ({
  default: (await import("../../components/AgentWalletDashboard"))
    .AgentWalletDashboard,
}));
export const AgentManagement = lazy(async () => ({
  default: (await import("../../components/AgentManagement")).AgentManagement,
}));
