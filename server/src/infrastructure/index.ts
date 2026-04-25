/**
 * Infrastructure Module
 *
 * Centralized infrastructure services for the application.
 * Provides distributed cache, event bus, and other cross-cutting concerns.
 */

export {
  initializeRedis,
  shutdownRedis,
  getDistributedCache,
  getNamespacedCache,
  getDistributedEventBus,
  isRedisConnected,
  getRedisClient,
  checkRedisHealth,
} from './redis';

export {
  acquireLock,
  releaseLock,
  extendLock,
  withLock,
  isLocked,
  shutdownDistributedLock,
  type DistributedLock,
  type LockOptions,
} from './distributedLock';

export {
  queueConsolidationSuggestionNotification,
  queueTransactionNotification,
  shutdownNotificationDispatcher,
  type ConsolidationSuggestionNotificationPayload,
  type TransactionNotificationPayload,
} from './notificationDispatcher';
