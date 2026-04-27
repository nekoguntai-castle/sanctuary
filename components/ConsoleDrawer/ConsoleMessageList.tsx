import React from 'react';
import {
  Brain,
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  UserRound,
} from 'lucide-react';
import { summarizeTrace } from './consoleDrawerUtils';
import type { ConsoleMessage } from './types';

interface ConsoleMessageListProps {
  messages: ConsoleMessage[];
  loading: boolean;
  sending: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

const traceIcon = {
  completed: CheckCircle2,
  denied: CircleSlash,
  failed: CircleAlert,
};

const ConsoleTraceList: React.FC<{ traces?: ConsoleMessage['traces'] }> = ({
  traces,
}) => {
  if (!traces || traces.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {traces.map((trace) => {
        const Icon = traceIcon[trace.status];
        return (
          <div
            key={trace.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 px-2 py-1 text-[11px] text-sanctuary-600 dark:text-sanctuary-300 surface-muted"
            title={summarizeTrace(trace)}
          >
            <Icon className="h-3 w-3 flex-shrink-0" />
            <span className="font-medium">{trace.toolName}</span>
            <span className="truncate text-sanctuary-400 dark:text-sanctuary-500">
              {trace.status}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const EmptyConsoleState = () => (
  <div className="flex min-h-[260px] items-center justify-center px-8 text-center">
    <div>
      <Brain className="mx-auto h-8 w-8 text-primary-500 dark:text-primary-400" />
      <p className="mt-3 text-sm font-medium text-sanctuary-800 dark:text-sanctuary-100">
        Sanctuary Console
      </p>
      <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">
        Ready
      </p>
    </div>
  </div>
);

export const ConsoleMessageList: React.FC<ConsoleMessageListProps> = ({
  messages,
  loading,
  sending,
  messagesEndRef,
}) => {
  if (loading) {
    return (
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="h-16 animate-shimmer rounded-lg" />
        <div className="h-24 animate-shimmer rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {messages.length === 0 ? <EmptyConsoleState /> : null}

      <div className="space-y-4">
        {messages.map((message) => {
          const isUser = message.role === 'user';
          const Icon = isUser ? UserRound : Brain;

          return (
            <div
              key={message.id}
              className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <span className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg surface-secondary text-primary-600 dark:text-primary-400">
                  <Icon className="h-4 w-4" />
                </span>
              )}

              <div
                className={`max-w-[86%] rounded-lg px-3 py-2 text-sm leading-6 ${
                  isUser
                    ? 'bg-primary-700 text-white dark:bg-primary-300 dark:text-primary-950'
                    : 'surface-muted text-sanctuary-800 dark:text-sanctuary-100 border border-sanctuary-200 dark:border-sanctuary-800'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">
                  {message.content}
                </p>
                {!isUser && <ConsoleTraceList traces={message.traces} />}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="flex gap-3">
            <span className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg surface-secondary text-primary-600 dark:text-primary-400">
              <Brain className="h-4 w-4" />
            </span>
            <div className="surface-muted rounded-lg border border-sanctuary-200 dark:border-sanctuary-800 px-3 py-2 text-sm text-sanctuary-500">
              Working...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
