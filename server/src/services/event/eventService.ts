/**
 * Event Service
 *
 * Unified service for emitting events across the application.
 * Coordinates between the internal event bus and WebSocket broadcasts.
 *
 * This service ensures that:
 * 1. All significant events are emitted to the event bus for internal subscribers
 * 2. Client-relevant events are broadcast via WebSocket for real-time updates
 * 3. Events are logged for debugging and audit purposes
 *
 * @example
 * // In a service
 * import { eventService } from './eventService';
 *
 * // After syncing a wallet
 * await eventService.emitWalletSynced({
 *   walletId,
 *   balance,
 *   unconfirmedBalance,
 *   transactionCount,
 *   duration,
 * });
 */

import { eventBus, EventTypes } from '../../events/eventBus';
import type { DeviceRoleValue } from '@sanctuary/shared/constants/deviceRoles';

// Import domain event emitters
import * as walletEvents from './walletEvents';
import * as transactionEvents from './transactionEvents';
import * as userEvents from './userEvents';
import * as deviceEvents from './deviceEvents';
import * as systemEvents from './systemEvents';

// Import types for method signatures
import type {
  WalletSyncResult,
  WalletCreatedData,
  BalanceChangeData,
  TransactionBroadcastResult,
  TransactionReceivedData,
  TransactionConfirmationData,
  UserLoginData,
  DeviceRegisteredData,
} from './types';

/**
 * Unified Event Service
 */
class EventService {
  // ===========================================================================
  // Wallet Events
  // ===========================================================================

  emitWalletSynced(data: WalletSyncResult): void {
    walletEvents.emitWalletSynced(data);
  }

  emitWalletSyncStarted(walletId: string, fullResync: boolean = false): void {
    walletEvents.emitWalletSyncStarted(walletId, fullResync);
  }

  emitWalletSyncFailed(walletId: string, error: string, retryCount: number = 0): void {
    walletEvents.emitWalletSyncFailed(walletId, error, retryCount);
  }

  emitWalletCreated(data: WalletCreatedData): void {
    walletEvents.emitWalletCreated(data);
  }

  emitWalletDeleted(walletId: string, userId: string): void {
    walletEvents.emitWalletDeleted(walletId, userId);
  }

  emitBalanceChanged(data: BalanceChangeData): void {
    walletEvents.emitBalanceChanged(data);
  }

  // ===========================================================================
  // Transaction Events
  // ===========================================================================

  emitTransactionSent(data: TransactionBroadcastResult): void {
    transactionEvents.emitTransactionSent(data);
  }

  emitTransactionReceived(data: TransactionReceivedData): void {
    transactionEvents.emitTransactionReceived(data);
  }

  emitTransactionConfirmed(data: TransactionConfirmationData): void {
    transactionEvents.emitTransactionConfirmed(data);
  }

  emitTransactionReplaced(walletId: string, originalTxid: string, replacementTxid: string): void {
    transactionEvents.emitTransactionReplaced(walletId, originalTxid, replacementTxid);
  }

  // ===========================================================================
  // User Events
  // ===========================================================================

  emitUserLogin(data: UserLoginData): void {
    userEvents.emitUserLogin(data);
  }

  emitUserLogout(userId: string): void {
    userEvents.emitUserLogout(userId);
  }

  emitUserCreated(userId: string, username: string): void {
    userEvents.emitUserCreated(userId, username);
  }

  emitPasswordChanged(userId: string): void {
    userEvents.emitPasswordChanged(userId);
  }

  emitTwoFactorEnabled(userId: string): void {
    userEvents.emitTwoFactorEnabled(userId);
  }

  emitTwoFactorDisabled(userId: string): void {
    userEvents.emitTwoFactorDisabled(userId);
  }

  // ===========================================================================
  // Device Events
  // ===========================================================================

  emitDeviceRegistered(data: DeviceRegisteredData): void {
    deviceEvents.emitDeviceRegistered(data);
  }

  emitDeviceDeleted(deviceId: string, userId: string): void {
    deviceEvents.emitDeviceDeleted(deviceId, userId);
  }

  emitDeviceShared(deviceId: string, ownerId: string, sharedWithUserId: string, role: DeviceRoleValue): void {
    deviceEvents.emitDeviceShared(deviceId, ownerId, sharedWithUserId, role);
  }

  // ===========================================================================
  // System Events
  // ===========================================================================

  emitSystemStartup(version: string, environment: string): void {
    systemEvents.emitSystemStartup(version, environment);
  }

  emitSystemShutdown(reason: string): void {
    systemEvents.emitSystemShutdown(reason);
  }

  emitMaintenanceStarted(task: string): void {
    systemEvents.emitMaintenanceStarted(task);
  }

  emitMaintenanceCompleted(task: string, duration: number, success: boolean): void {
    systemEvents.emitMaintenanceCompleted(task, duration, success);
  }

  // ===========================================================================
  // Blockchain Events
  // ===========================================================================

  emitNewBlock(network: string, height: number, hash: string): void {
    systemEvents.emitNewBlock(network, height, hash);
  }

  emitFeeEstimateUpdated(network: string, fastestFee: number, halfHourFee: number, hourFee: number): void {
    systemEvents.emitFeeEstimateUpdated(network, fastestFee, halfHourFee, hourFee);
  }

  emitPriceUpdated(btcUsd: number, source: string): void {
    systemEvents.emitPriceUpdated(btcUsd, source);
  }

  // ===========================================================================
  // Direct Event Bus Access (for custom events)
  // ===========================================================================

  /**
   * Subscribe to an event
   */
  on<E extends keyof EventTypes>(event: E, handler: (data: EventTypes[E]) => void | Promise<void>): () => void {
    return eventBus.on(event, handler);
  }

  /**
   * Subscribe to an event once
   */
  once<E extends keyof EventTypes>(event: E, handler: (data: EventTypes[E]) => void | Promise<void>): void {
    eventBus.once(event, handler);
  }

  /**
   * Emit a raw event (for events not covered by helper methods)
   */
  emit<E extends keyof EventTypes>(event: E, data: EventTypes[E]): void {
    eventBus.emit(event, data);
  }

  /**
   * Get event bus metrics
   */
  getMetrics() {
    return eventBus.getMetrics();
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const eventService = new EventService();
export default eventService;
