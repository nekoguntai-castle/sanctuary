export interface ConsoleToolDescription {
  name: string;
  title: string;
  description: string;
  sensitivity: string;
  requiredScope: string;
  inputFields: string[];
}

export interface ConsolePlannedToolCall {
  name: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface ConsolePlanResponse {
  toolCalls: ConsolePlannedToolCall[];
  warnings: string[];
}

export interface ConsolePlanInput {
  prompt: string;
  currentDate?: string;
  scope?: unknown;
  context?: unknown;
  maxToolCalls: number;
  tools: ConsoleToolDescription[];
}

export interface ConsoleToolResultForSynthesis {
  toolName: string;
  status: "completed" | "denied" | "failed";
  input?: unknown;
  sensitivity?: string;
  facts?: unknown;
  provenance?: unknown;
  redactions?: unknown;
  truncation?: unknown;
  warnings?: unknown;
  error?: string;
}

export interface FallbackWalletSelection {
  walletIds: string[];
  warnings: string[];
}

export interface FallbackToolPlan {
  toolCalls: ConsolePlannedToolCall[];
  warnings: string[];
}
