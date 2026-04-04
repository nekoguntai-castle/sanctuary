import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, MessageSquare, Send, Brain } from 'lucide-react';
import * as intelligenceApi from '../../../src/api/intelligence';
import type { AIConversation, AIMessage } from '../../../src/api/intelligence';
import { ChatMessage } from './ChatMessage';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ChatTab');

interface ChatTabProps {
  walletId: string;
}

export const ChatTab: React.FC<ChatTabProps> = ({ walletId }) => {
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const result = await intelligenceApi.getConversations();
      setConversations(result.conversations);
    } catch (error) {
      log.error('Failed to load conversations', { error });
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages for selected conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      setLoadingMessages(true);
      const result = await intelligenceApi.getConversationMessages(conversationId);
      setMessages(result.messages);
    } catch (error) {
      log.error('Failed to load messages', { error });
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedConversationId) {
      loadMessages(selectedConversationId);
    } else {
      setMessages([]);
    }
  }, [selectedConversationId, loadMessages]);

  // Create a new conversation
  const handleNewConversation = useCallback(async () => {
    try {
      const result = await intelligenceApi.createConversation(walletId);
      setConversations((prev) => [result.conversation, ...prev]);
      setSelectedConversationId(result.conversation.id);
      setMessages([]);
      inputRef.current?.focus();
    } catch (error) {
      log.error('Failed to create conversation', { error });
    }
  }, [walletId]);

  // Delete a conversation
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await intelligenceApi.deleteConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (selectedConversationId === id) {
          setSelectedConversationId(null);
          setMessages([]);
        }
      } catch (error) {
        log.error('Failed to delete conversation', { error });
      }
    },
    [selectedConversationId]
  );

  // Send a message
  const handleSend = useCallback(async () => {
    if (!input.trim() || !selectedConversationId || sending) return;

    const content = input.trim();
    setInput('');
    setSending(true);

    // Optimistically add user message
    const tempUserMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      conversationId: selectedConversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const result = await intelligenceApi.sendChatMessage(
        selectedConversationId,
        content,
        { walletId }
      );
      // Replace temp message with real ones
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        result.userMessage,
        result.assistantMessage,
      ]);
    } catch (error) {
      log.error('Failed to send message', { error });
      // Remove temp message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setInput(content); // Restore input
    } finally {
      setSending(false);
    }
  }, [input, selectedConversationId, sending, walletId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex h-full gap-3">
      {/* Left panel: conversation list */}
      <div className="flex w-56 flex-shrink-0 flex-col rounded-xl border border-sanctuary-200 bg-white dark:border-sanctuary-800 dark:bg-sanctuary-900">
        {/* New conversation button */}
        <div className="border-b border-sanctuary-200 p-2 dark:border-sanctuary-800">
          <button
            onClick={handleNewConversation}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-primary-700 dark:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-300"
          >
            <Plus className="h-3.5 w-3.5" />
            New Conversation
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loadingConversations ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-sanctuary-400 dark:text-sanctuary-500">
              <MessageSquare className="h-5 w-5" />
              <p className="text-[10px]">No conversations yet</p>
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 ${
                    selectedConversationId === conv.id
                      ? 'bg-primary-50 dark:bg-primary-100/10'
                      : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
                  }`}
                >
                  <button
                    onClick={() => setSelectedConversationId(conv.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p
                      className={`truncate text-[11px] ${
                        selectedConversationId === conv.id
                          ? 'font-medium text-primary-600 dark:text-primary-300'
                          : 'text-sanctuary-700 dark:text-sanctuary-300'
                      }`}
                    >
                      {conv.title || 'New conversation'}
                    </p>
                    <p className="text-[9px] text-sanctuary-400 dark:text-sanctuary-500">
                      {new Date(conv.updatedAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.id);
                    }}
                    className="flex-shrink-0 rounded p-0.5 text-sanctuary-400 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100 dark:text-sanctuary-500 dark:hover:text-rose-400"
                    title="Delete conversation"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: messages + input */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-sanctuary-200 bg-white dark:border-sanctuary-800 dark:bg-sanctuary-900">
        {selectedConversationId ? (
          <>
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-3">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-sanctuary-400 dark:text-sanctuary-500">
                  <Brain className="h-8 w-8" />
                  <p className="text-[11px]">Ask anything about your wallet</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {messages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
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
              )}
            </div>

            {/* Input area */}
            <div className="border-t border-sanctuary-200 p-2 dark:border-sanctuary-800">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your wallet..."
                  rows={1}
                  className="min-h-[32px] max-h-[120px] flex-1 resize-none rounded-lg border border-sanctuary-200 bg-sanctuary-50 px-3 py-1.5 text-[11px] text-sanctuary-800 placeholder:text-sanctuary-400 focus:border-primary-500 focus:outline-none dark:border-sanctuary-700 dark:bg-sanctuary-950 dark:text-sanctuary-200 dark:placeholder:text-sanctuary-500"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:opacity-50 dark:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-300"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sanctuary-400 dark:text-sanctuary-500">
            <Brain className="h-10 w-10" />
            <p className="text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400">
              Treasury Intelligence Chat
            </p>
            <p className="text-[11px]">Select a conversation or start a new one</p>
          </div>
        )}
      </div>
    </div>
  );
};
