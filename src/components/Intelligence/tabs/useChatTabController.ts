import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as intelligenceApi from '../../../api/intelligence';
import type { AIConversation, AIMessage } from '../../../api/intelligence';
import { createRequestOwnership } from '../../../hooks/requestOwnership';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ChatTab');

export const useChatTabController = ({ walletId }: { walletId: string }) => {
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRequests = useRef(createRequestOwnership(`${walletId}:none`));
  const listRequests = useRef(createRequestOwnership(walletId));
  const selectionKey = `${walletId}:${selectedConversationId ?? 'none'}`;
  conversationRequests.current.setRoute(selectionKey);
  listRequests.current.setRoute(walletId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = useCallback(async () => {
    const token = listRequests.current.beginFetch(walletId);
    setLoadingConversations(true);
    try {
      const result = await intelligenceApi.getConversations(walletId);
      if (listRequests.current.isFetchOwner(token)) setConversations(result.conversations);
    } catch (error) {
      if (listRequests.current.isFetchOwner(token)) log.error('Failed to load conversations', { error });
    } finally {
      if (listRequests.current.isFetchOwner(token)) setLoadingConversations(false);
    }
  }, [walletId]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const selectConversation = useCallback((conversationId: string | null) => {
    conversationRequests.current.setRoute(`${walletId}:${conversationId ?? 'none'}`);
    setSelectedConversationId(conversationId);
    setMessages([]);
    setInput('');
    setLoadingMessages(Boolean(conversationId));
    setSending(false);
  }, [walletId]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const token = conversationRequests.current.beginFetch(selectionKey);
    void (async () => {
      try {
        const result = await intelligenceApi.getConversationMessages(selectedConversationId);
        if (conversationRequests.current.isFetchOwner(token)) setMessages(result.messages);
      } catch (error) {
        if (conversationRequests.current.isFetchOwner(token)) log.error('Failed to load messages', { error });
      } finally {
        if (conversationRequests.current.isFetchOwner(token)) setLoadingMessages(false);
      }
    })();
  }, [selectedConversationId, selectionKey]);

  const handleNewConversation = useCallback(async () => {
    const token = listRequests.current.beginFetch(walletId);
    setLoadingConversations(true);
    try {
      const result = await intelligenceApi.createConversation(walletId);
      if (!listRequests.current.isFetchOwner(token)) return;
      setConversations((prev) => [result.conversation, ...prev]);
      selectConversation(result.conversation.id);
      inputRef.current?.focus();
      await loadConversations();
    } catch (error) {
      if (listRequests.current.isFetchOwner(token)) {
        log.error('Failed to create conversation', { error });
        await loadConversations();
      }
    }
  }, [loadConversations, selectConversation, walletId]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    const token = listRequests.current.beginFetch(walletId);
    setLoadingConversations(true);
    try {
      await intelligenceApi.deleteConversation(id);
      if (!listRequests.current.isFetchOwner(token)) return;
      setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
      if (selectedConversationId === id) selectConversation(null);
      await loadConversations();
    } catch (error) {
      if (listRequests.current.isFetchOwner(token)) {
        log.error('Failed to delete conversation', { error });
        await loadConversations();
      }
    }
  }, [loadConversations, selectConversation, selectedConversationId, walletId]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || !selectedConversationId || sending) return;
    const token = conversationRequests.current.captureRoute(selectionKey);
    const tempUserMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      conversationId: selectedConversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setInput('');
    setSending(true);
    setMessages((prev) => [...prev, tempUserMsg]);
    try {
      const result = await intelligenceApi.sendChatMessage(selectedConversationId, content);
      if (!conversationRequests.current.isRouteOwner(token)) return;
      setMessages((prev) => [...prev.filter((message) => message.id !== tempUserMsg.id), result.userMessage, result.assistantMessage]);
    } catch (error) {
      if (!conversationRequests.current.isRouteOwner(token)) return;
      log.error('Failed to send message', { error });
      setMessages((prev) => prev.filter((message) => message.id !== tempUserMsg.id));
      setInput(content);
    } finally {
      if (conversationRequests.current.isRouteOwner(token)) setSending(false);
    }
  }, [input, selectedConversationId, selectionKey, sending]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  return {
    conversations, selectedConversationId, messages, input, loadingConversations,
    loadingMessages, sending, messagesEndRef, inputRef, setInput,
    setSelectedConversationId: selectConversation, handleNewConversation,
    handleDeleteConversation, handleSend, handleKeyDown, reloadConversations: loadConversations,
  };
};

export type ChatTabController = ReturnType<typeof useChatTabController>;
