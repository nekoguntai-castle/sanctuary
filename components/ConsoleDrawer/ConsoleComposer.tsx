import React from 'react';
import { SendHorizontal } from 'lucide-react';

interface ConsoleComposerProps {
  input: string;
  sending: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => Promise<void>;
}

export const ConsoleComposer: React.FC<ConsoleComposerProps> = ({
  input,
  sending,
  inputRef,
  onInputChange,
  onSend,
}) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  };

  return (
    <div className="border-t border-sanctuary-200 dark:border-sanctuary-800 p-4">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          aria-label="Console prompt"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          maxLength={12000}
          placeholder="Ask Sanctuary..."
          className="min-h-[84px] flex-1 resize-none rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 surface-muted px-3 py-2 text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={sending || input.trim().length === 0}
          title="Send prompt"
          aria-label="Send prompt"
          className="h-10 w-10 flex-shrink-0 rounded-lg bg-primary-700 text-white hover:bg-primary-600 dark:bg-primary-300 dark:text-primary-950 dark:hover:bg-primary-200 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
