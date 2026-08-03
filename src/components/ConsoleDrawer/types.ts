import type React from "react";
import type {
  ConsolePromptHistory,
  ConsoleScope,
  ConsoleSensitivity,
  ConsoleSetupReason,
  ConsoleSession,
  ConsoleTool,
  ConsoleToolTrace,
} from "../../api/console";
import type { Wallet } from "../../api/wallets";
import type { TabNetwork } from "../../app/networks";

export interface ConsoleDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  wallets: Wallet[];
  selectedNetwork: TabNetwork;
  isAdmin?: boolean;
}

export interface ConsoleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  details?: string;
  state?: string;
  traces?: ConsoleToolTrace[];
  accessWarnings?: string[];
  promptHistoryId?: string | null;
}

export interface ConsoleDrawerController {
  sessions: ConsoleSession[];
  tools: ConsoleTool[];
  prompts: ConsolePromptHistory[];
  messages: ConsoleMessage[];
  selectedSessionId: string | null;
  selectedWalletId: string;
  maxSensitivity: ConsoleSensitivity;
  input: string;
  promptSearch: string;
  loading: boolean;
  sending: boolean;
  replayingPromptId: string | null;
  error: string | null;
  setupNeeded: boolean;
  setupReason: ConsoleSetupReason | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  scope: ConsoleScope;
  setInput: (value: string) => void;
  setPromptSearch: (value: string) => void;
  setSelectedWalletId: (value: string) => void;
  setSelectedSessionId: (value: string | null) => void;
  setMaxSensitivity: (value: ConsoleSensitivity) => void;
  selectSession: (sessionId: string | null) => Promise<void>;
  startNewSession: () => void;
  clearDisplay: () => void;
  clearSelectedSession: () => Promise<void>;
  clearPromptHistory: () => Promise<void>;
  sendPrompt: () => Promise<void>;
  replayPrompt: (promptId: string) => Promise<void>;
  raiseAccessAndReplay: (promptId?: string | null) => Promise<void>;
  deletePrompt: (promptId: string) => Promise<void>;
  togglePromptSaved: (prompt: ConsolePromptHistory) => Promise<void>;
  setPromptExpiration: (
    prompt: ConsolePromptHistory,
    days: number | null,
  ) => Promise<void>;
  refreshPrompts: () => Promise<void>;
}
