/**
 * Support Package Collector Registration
 *
 * Imports all collector modules to trigger their self-registration,
 * then re-exports the registry functions.
 */

// Re-export registry functions
export { registerCollector, getCollectors } from './registry';

// Import collectors to trigger registration
import './system';
import './health';
import './config';
import './circuitBreakers';
import './deadLetterQueue';
import './telegram';
import './sync';
import './database';
import './wallets';
import './walletLogs';
import './electrumPool';
import './jobQueue';
import './workerHealth';
import './auditLog';
import './cache';
import './push';
import './container';
import './agentWallets';
import './aiIntelligence';
import './backups';
import './devices';
import './drafts';
import './mcp';
import './mobilePermissions';
import './vaultPolicy';
