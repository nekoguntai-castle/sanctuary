/**
 * Registered MCP prompt names.
 *
 * Single source of truth for both prompt registration (`./prompts`) and the
 * bounded metrics label allowlist (`./metrics`): a prompt registered under a
 * name that is not listed here collapses to the `prompt:other` metric label.
 * This module has no dependencies so it can be imported by lightweight
 * modules and unit tests without loading the prompt handlers.
 */
export const MCP_PROMPT_NAMES = {
  transactionAnalysis: 'transaction_analysis',
  utxoManagement: 'utxo_management',
  spendingAnalysis: 'spending_analysis',
  feeOptimization: 'fee_optimization',
  walletHealth: 'wallet_health',
} as const;

export const MCP_PROMPT_NAME_VALUES: readonly string[] = Object.values(MCP_PROMPT_NAMES);
