/**
 * Repository Layer
 *
 * Centralized exports for all repository modules.
 * This provides a clean abstraction layer over direct Prisma usage.
 *
 * Usage:
 *   import { walletRepository, transactionRepository } from '../repositories';
 *
 *   // Check wallet access
 *   const wallet = await walletRepository.findByIdWithAccess(walletId, userId);
 *
 *   // Delete transactions
 *   const count = await transactionRepository.deleteByWalletId(walletId);
 */

export { walletRepository, default as walletRepo } from './walletRepository';
export { transactionRepository, default as transactionRepo } from './transactionRepository';
export { addressRepository, default as addressRepo } from './addressRepository';
export { utxoRepository, default as utxoRepo } from './utxoRepository';
export { userRepository, default as userRepo } from './userRepository';
export { walletSharingRepository, default as walletSharingRepo } from './walletSharingRepository';
export { labelRepository, default as labelRepo } from './labelRepository';
export { draftRepository, default as draftRepo } from './draftRepository';
export { deviceRepository, default as deviceRepo } from './deviceRepository';
export { pushDeviceRepository, default as pushDeviceRepo } from './pushDeviceRepository';
export { sessionRepository, default as sessionRepo } from './sessionRepository';
export { auditLogRepository, default as auditLogRepo } from './auditLogRepository';
export { systemSettingRepository, default as systemSettingRepo } from './systemSettingRepository';
export { mobilePermissionRepository, default as mobilePermissionRepo } from './mobilePermissionRepository';
export { emailVerificationRepository, default as emailVerificationRepo } from './emailVerificationRepository';
export { policyRepository, default as policyRepo } from './policyRepository';
export { intelligenceRepository, default as intelligenceRepo } from './intelligenceRepository';
export { default as groupRepo } from './groupRepository';

// Access control helpers
export { buildWalletAccessWhere, buildDeviceAccessWhere } from './accessControl';

// Re-export types
export type {
  NetworkType,
  WalletWithAddresses,
  WalletAccessFilter,
  WalletNetworkFilter,
  WalletSyncState,
  TransactionFilter,
  AddressFilter,
} from './types';

export type {
  LabelWithCounts,
  LabelWithAssociations,
  CreateLabelInput,
  UpdateLabelInput,
} from './labelRepository';

export type {
  DraftStatus,
  CreateDraftInput,
  UpdateDraftInput,
} from './draftRepository';

export type {
  DeviceWithUsers,
  DeviceWithAssociations,
  CreateDeviceInput,
} from './deviceRepository';

export type {
  PushPlatform,
  CreatePushDeviceInput,
} from './pushDeviceRepository';

export type {
  CreateRefreshTokenInput,
  SessionInfo,
} from './sessionRepository';

export type {
  AuditCategory,
  CreateAuditLogInput,
  AuditLogFilter,
  PaginationOptions,
} from './auditLogRepository';

export { SystemSettingKeys } from './systemSettingRepository';
export type { SystemSettingKey } from './systemSettingRepository';

export type {
  InsightType,
  InsightSeverity,
  InsightStatus,
  InsightFilter,
  CreateInsightInput,
  CreateConversationInput,
  CreateMessageInput,
} from './intelligenceRepository';

export type {
  MobilePermissionCapability,
  CreateMobilePermissionInput,
  UpdateMobilePermissionInput,
} from './mobilePermissionRepository';
