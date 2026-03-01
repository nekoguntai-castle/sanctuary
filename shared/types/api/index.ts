/**
 * Shared API Contract Types
 *
 * These types define the contract between frontend and backend.
 * Both sides must use these types to ensure compatibility.
 *
 * ## Usage
 *
 * Backend: Use these types in API route responses
 * ```typescript
 * import { WalletResponse } from '@sanctuary/shared/types/api';
 * res.json(wallet as WalletResponse);
 * ```
 *
 * Frontend: Use these types in API clients
 * ```typescript
 * import { WalletResponse } from '@sanctuary/shared/types/api';
 * const wallet = await apiClient.get<WalletResponse>('/wallets/123');
 * ```
 */

// Common types (errors, pagination, success)
export type { ApiErrorResponse, PaginatedResponse, SuccessResponse } from './common';

// Wallet types
export type {
  ApiWalletType,
  ApiScriptType,
  ApiNetwork,
  ApiWalletRole,
  ApiSyncStatus,
  WalletResponse,
  CreateWalletRequest,
  UpdateWalletRequest,
  WalletStatsResponse,
} from './wallet';

// Device types
export type {
  ApiDeviceRole,
  DeviceResponse,
  CreateDeviceRequest,
  UpdateDeviceRequest,
} from './device';

// Transaction types
export type {
  ApiTransactionType,
  ApiTransactionStatus,
  TransactionResponse,
} from './transaction';

// Auth types
export type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  UserResponse,
} from './auth';

// Bitcoin infrastructure types (sync, price, fees, broadcast)
export type {
  SyncWalletResponse,
  PriceResponse,
  FeeEstimatesResponse,
  BroadcastRequest,
  BroadcastResponse,
} from './bitcoin';

// Draft types
export type { ApiDraftStatus, DraftResponse, CreateDraftRequest } from './draft';

// Admin types
export type { AdminUserResponse, AdminStatsResponse } from './admin';
