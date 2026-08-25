/**
 * Backup Serialization
 *
 * Handles serialization of backup records.
 * Converts Prisma model types (Date, BigInt) to JSON-safe representations.
 */

import type { BackupRecord } from './types';

/**
 * Serialize a record for JSON export (converts BigInt to string)
 */
export function serializeRecord(record: BackupRecord): BackupRecord {
  const serialized: BackupRecord = {};

  for (const key of Object.keys(record)) {
    serialized[key] = serializeValue(record[key]);
  }

  return serialized;
}

/**
 * Serialize a single value for JSON export
 */
function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'bigint') {
    // Store BigInt as string with special marker for restore
    return `__bigint__${value.toString()}`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    // Preserve arrays, serialize each element
    return value.map((item: unknown) => serializeValue(item));
  }
  if (typeof value === 'object') {
    // Recursively handle nested objects
    return serializeRecord(value as BackupRecord);
  }
  return value;
}

/**
 * Convert Prisma model name (camelCase) to PostgreSQL table name (snake_case, plural)
 * Prisma uses lowercase plural snake_case for table names by default
 */
export function camelToSnakeCase(modelName: string): string {
  // Special cases mapping
  const specialCases: Record<string, string> = {
    'uTXO': 'utxos',
    'hardwareDeviceModel': 'hardware_device_models',
    'systemSetting': 'system_settings',
    'nodeConfig': 'node_configs',
    'groupMember': 'group_members',
    'pushDevice': 'push_devices',
    'electrumServer': 'electrum_servers',
    'walletUser': 'wallet_users',
    'walletDevice': 'wallet_devices',
    'deviceAccount': 'device_accounts',
    'deviceUser': 'device_users',
    'draftTransaction': 'draft_transactions',
    'draftUtxoLock': 'draft_utxo_locks',
    'transactionInput': 'transaction_inputs',
    'transactionOutput': 'transaction_outputs',
    'transactionLabel': 'transaction_labels',
    'addressLabel': 'address_labels',
    'auditLog': 'audit_logs',
    'mcpApiKey': 'mcp_api_keys',
    'webhookEndpoint': 'webhook_endpoints',
    'webhookDelivery': 'webhook_deliveries',
    'refreshToken': 'refresh_tokens',
    'revokedToken': 'revoked_tokens',
    'ownershipTransfer': 'ownership_transfers',
    'mobilePermission': 'mobile_permissions',
    'featureFlag': 'feature_flags',
    'featureFlagAudit': 'feature_flag_audit',
    'emailVerificationToken': 'email_verification_tokens',
    'vaultPolicy': 'vault_policies',
    'approvalRequest': 'approval_requests',
    'approvalVote': 'approval_votes',
    'policyEvent': 'policy_events',
    'policyAddress': 'policy_addresses',
    'policyUsageWindow': 'policy_usage_windows',
    'aIInsight': 'ai_insights',
    'aIConversation': 'ai_conversations',
    'aIMessage': 'ai_messages',
    'consoleSession': 'console_sessions',
    'consoleTurn': 'console_turns',
    'consoleToolTrace': 'console_tool_traces',
    'consolePromptHistory': 'console_prompt_history',
    'walletAgent': 'wallet_agents',
    'agentApiKey': 'agent_api_keys',
    'agentFundingAttempt': 'agent_funding_attempts',
    'agentFundingOverride': 'agent_funding_overrides',
    'agentAlert': 'agent_alerts',
    'priceData': 'price_data',
    'feeEstimate': 'fee_estimates',
    'networkSubscriptionCoverageState': 'network_subscription_coverage_state',
    'networkHeaderCheckpoint': 'network_header_checkpoints',
    'networkHeaderReconciliation': 'network_header_reconciliations',
    'networkHeaderConfirmationRetry': 'network_header_confirmation_retries',
    'networkHeaderReconciliationHeader': 'network_header_reconciliation_headers',
    'networkHeaderHistory': 'network_header_history',
  };

  if (specialCases[modelName]) {
    return specialCases[modelName];
  }

  // Default: convert to snake_case and pluralize
  const snakeCase = modelName
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();

  // Simple pluralization
  if (snakeCase.endsWith('s')) {
    return snakeCase + 'es'; // address -> addresses
  }
  if (snakeCase.endsWith('y')) {
    return snakeCase.slice(0, -1) + 'ies'; // category -> categories
  }
  return snakeCase + 's'; // user -> users, wallet -> wallets
}
