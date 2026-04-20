import type React from 'react';
import { Send } from 'lucide-react';

interface ChatInputComposerProps {
  input: string;
  sending: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSend: () => void;
}

export const ChatInputComposer: React.FC<ChatInputComposerProps> = ({
  input,
  sending,
  inputRef,
  onInputChange,
  onKeyDown,
  onSend,
}) => (
  <div className="border-t border-sanctuary-200 p-2 dark:border-sanctuary-800">
    <div className="flex items-end gap-2">
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about your wallet..."
        rows={1}
        className="min-h-[32px] max-h-[120px] flex-1 resize-none rounded-lg border border-sanctuary-200 bg-sanctuary-50 px-3 py-1.5 text-[11px] text-sanctuary-800 placeholder:text-sanctuary-400 focus:border-primary-500 focus:outline-none dark:border-sanctuary-700 dark:bg-sanctuary-950 dark:text-sanctuary-200 dark:placeholder:text-sanctuary-500"
      />
      <button
        onClick={onSend}
        disabled={!input.trim() || sending}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:opacity-50 dark:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-300"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);
