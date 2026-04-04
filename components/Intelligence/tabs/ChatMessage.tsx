import React from 'react';
import { Brain } from 'lucide-react';
import type { AIMessage } from '../../../src/api/intelligence';

interface ChatMessageProps {
  message: AIMessage;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`flex max-w-[80%] gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        {/* Avatar */}
        {!isUser && (
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-100/20">
            <Brain className="h-3.5 w-3.5 text-primary-600 dark:text-primary-300" />
          </div>
        )}

        {/* Bubble */}
        <div>
          <div
            className={`rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
              isUser
                ? 'bg-primary-600 text-white dark:bg-primary-200 dark:text-primary-900'
                : 'bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-200'
            }`}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
          <p
            className={`mt-0.5 text-[9px] text-sanctuary-400 dark:text-sanctuary-500 ${
              isUser ? 'text-right' : 'text-left'
            }`}
          >
            {formatTime(message.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
};
