import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as intelligenceApi from '../../../src/api/intelligence';
import type { AIConversation, AIMessage } from '../../../src/api/intelligence';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ChatTab');

interface UseChatTabControllerOptions {
  walletId: string;
}

export const useChatTabController = ({ walletId }: UseChatTabControllerOptions) => {
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const handleSend = useCallback(async () => {
    if (!input.trim() || !selectedConversationId || sending) return;

    const content = input.trim();
    setInput('');
    setSending(true);

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
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        result.userMessage,
        result.assistantMessage,
      ]);
    } catch (error) {
      log.error('Failed to send message', { error });
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setInput(content);
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

  return {
    conversations,
    selectedConversationId,
    messages,
    input,
    loadingConversations,
    loadingMessages,
    sending,
    messagesEndRef,
    inputRef,
    setInput,
    setSelectedConversationId,
    handleNewConversation,
    handleDeleteConversation,
    handleSend,
    handleKeyDown,
  };
};

export type ChatTabController = ReturnType<typeof useChatTabController>;
