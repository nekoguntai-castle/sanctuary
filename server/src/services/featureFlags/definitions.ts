import type { FeatureFlagKey } from "../../config";

export interface FeatureFlagDefinition {
  description: string;
  category: "general" | "experimental";
  hasSideEffects?: boolean;
  sideEffectDescription?: string;
}

export const UNKNOWN_FEATURE_FLAG_KEY_MESSAGE = "Unknown feature flag key";

export const FEATURE_DEFINITIONS: Record<
  FeatureFlagKey,
  FeatureFlagDefinition
> = {
  hardwareWalletSigning: {
    description: "Enable hardware wallet signing support",
    category: "general",
  },
  qrCodeSigning: {
    description: "Enable QR code based transaction signing",
    category: "general",
  },
  multisigWallets: {
    description: "Enable multi-signature wallet support",
    category: "general",
  },
  batchSync: {
    description: "Enable batch synchronization of wallets",
    category: "general",
  },
  payjoinSupport: {
    description: "Enable PayJoin (BIP78) transaction support",
    category: "general",
    hasSideEffects: true,
    sideEffectDescription:
      "Enables a public unauthenticated BIP78 endpoint. Requires PAYJOIN_PUBLIC_URL to be set for external reachability.",
  },
  batchTransactions: {
    description: "Enable batch transaction creation",
    category: "general",
  },
  rbfTransactions: {
    description: "Enable Replace-By-Fee transaction support",
    category: "general",
  },
  priceAlerts: {
    description: "Enable price alert notifications",
    category: "general",
  },
  aiAssistant: {
    description: "Enable AI-powered transaction analysis",
    category: "general",
  },
  sanctuaryConsole: {
    description:
      "Enable the Sanctuary Console backend for scoped AI-assisted investigations",
    category: "general",
    hasSideEffects: true,
    sideEffectDescription:
      "Allows authenticated users to send prompts to the configured AI provider through the backend-mediated console protocol.",
  },
  telegramNotifications: {
    description: "Enable Telegram bot notifications",
    category: "general",
  },
  treasuryAutopilot: {
    description: "Enable Treasury Autopilot consolidation jobs",
    category: "general",
    hasSideEffects: true,
    sideEffectDescription:
      "Toggling this starts or stops background consolidation jobs without requiring a restart.",
  },
  treasuryIntelligence: {
    description: "Enable Treasury Intelligence AI analysis",
    category: "general",
    hasSideEffects: true,
    sideEffectDescription:
      "Starts background AI analysis jobs. Requires a configured LLM provider endpoint such as Ollama, LM Studio, or another OpenAI-compatible service.",
  },
  websocketV2Events: {
    description: "Enable WebSocket v2 event format",
    category: "general",
  },
  "experimental.taprootAddresses": {
    description: "Enable Taproot (P2TR) address support",
    category: "experimental",
  },
  "experimental.silentPayments": {
    description: "Enable Silent Payments (BIP352)",
    category: "experimental",
  },
  "experimental.coinJoin": {
    description: "Enable CoinJoin transaction support",
    category: "experimental",
  },
};

export const FEATURE_FLAG_KEYS = Object.freeze(
  Object.keys(FEATURE_DEFINITIONS),
);
const featureFlagKeySet = new Set(FEATURE_FLAG_KEYS);

export function isKnownFeatureFlagKey(key: string): key is FeatureFlagKey {
  return featureFlagKeySet.has(key);
}

export function getFeatureFlagDefinition(
  key: string,
): FeatureFlagDefinition | undefined {
  return (FEATURE_DEFINITIONS as Record<string, FeatureFlagDefinition>)[key];
}
