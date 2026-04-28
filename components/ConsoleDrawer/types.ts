import type React from 'react';
import type {
  ConsolePromptHistory,
  ConsoleScope,
  ConsoleSetupReason,
  ConsoleSession,
  ConsoleTool,
  ConsoleToolTrace,
} from '../../src/api/console';
import type { Wallet } from '../../src/api/wallets';

export interface ConsoleDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  wallets: Wallet[];
  isAdmin?: boolean;
}

export interface ConsoleMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  details?: string;
  state?: string;
  traces?: ConsoleToolTrace[];
  promptHistoryId?: string | null;
}

export interface ConsoleDrawerController {
  sessions: ConsoleSession[];
  tools: ConsoleTool[];
  prompts: ConsolePromptHistory[];
  messages: ConsoleMessage[];
  selectedSessionId: string | null;
  selectedWalletId: string;
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
  selectSession: (sessionId: string | null) => Promise<void>;
  startNewSession: () => void;
  sendPrompt: () => Promise<void>;
  replayPrompt: (promptId: string) => Promise<void>;
  deletePrompt: (promptId: string) => Promise<void>;
  togglePromptSaved: (prompt: ConsolePromptHistory) => Promise<void>;
  setPromptExpiration: (
    prompt: ConsolePromptHistory,
    days: number | null
  ) => Promise<void>;
  refreshPrompts: () => Promise<void>;
}
