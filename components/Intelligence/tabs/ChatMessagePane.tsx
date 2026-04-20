import type React from 'react';
import { Brain } from 'lucide-react';
import type { AIMessage } from '../../../src/api/intelligence';
import { ChatInputComposer } from './ChatInputComposer';
import { ChatMessage } from './ChatMessage';

interface ChatMessagePaneProps {
  selectedConversationId: string | null;
  messages: AIMessage[];
  loadingMessages: boolean;
  sending: boolean;
  input: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSend: () => void;
}

export const ChatMessagePane: React.FC<ChatMessagePaneProps> = ({
  selectedConversationId,
  messages,
  loadingMessages,
  sending,
  input,
  messagesEndRef,
  inputRef,
  onInputChange,
  onKeyDown,
  onSend,
}) => (
  <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-sanctuary-200 bg-white dark:border-sanctuary-800 dark:bg-sanctuary-900">
    {selectedConversationId ? (
      <>
        <ChatMessages
          messages={messages}
          loadingMessages={loadingMessages}
          sending={sending}
          messagesEndRef={messagesEndRef}
        />
        <ChatInputComposer
          input={input}
          sending={sending}
          inputRef={inputRef}
          onInputChange={onInputChange}
          onKeyDown={onKeyDown}
          onSend={onSend}
        />
      </>
    ) : (
      <ChatSelectionPlaceholder />
    )}
  </div>
);

interface ChatMessagesProps {
  messages: AIMessage[];
  loadingMessages: boolean;
  sending: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  loadingMessages,
  sending,
  messagesEndRef,
}) => (
  <div className="flex-1 overflow-y-auto p-3">
    <ChatMessagesContent
      messages={messages}
      loadingMessages={loadingMessages}
      sending={sending}
      messagesEndRef={messagesEndRef}
    />
  </div>
);

function ChatMessagesContent({
  messages,
  loadingMessages,
  sending,
  messagesEndRef,
}: ChatMessagesProps) {
  if (loadingMessages) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-sanctuary-400 dark:text-sanctuary-500">
        <Brain className="h-8 w-8" />
        <p className="text-[11px]">Ask anything about your wallet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {sending && (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
          <span className="text-[10px] text-sanctuary-400 dark:text-sanctuary-500">
            Thinking...
          </span>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

const ChatSelectionPlaceholder: React.FC = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sanctuary-400 dark:text-sanctuary-500">
    <Brain className="h-10 w-10" />
    <p className="text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400">
      Treasury Intelligence Chat
    </p>
    <p className="text-[11px]">Select a conversation or start a new one</p>
  </div>
);
