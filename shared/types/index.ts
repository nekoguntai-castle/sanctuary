/**
 * Shared Types - Barrel Export
 *
 * Re-exports all shared types from a single entry point.
 * Import from '@sanctuary/shared/types' (workspace package — single way).
 *
 * Modules:
 * - domain: Core domain enums and types (WalletType, WalletNetwork, etc.)
 * - api: Common API request/response patterns (pagination, errors, etc.)
 * - logger: Logger interface and log levels
 * - websocket: WebSocket event types for real-time communication
 */

export * from './domain';
export * from './api';
export * from './logger';
export * from './websocket';
export * from './nodeOperationalStatus';
