/**
 * Conversation Service
 *
 * Manages interactive AI chat conversations for Treasury Intelligence.
 */

import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import {
  getAIConfig,
  syncConfigToContainer,
  getContainerUrl,
} from "../ai/config";
import { buildAIProxyJsonHeaders } from "../ai/proxyClient";
import { intelligenceRepository } from "../../repositories/intelligenceRepository";
import type { AIConversation, AIMessage } from "../../generated/prisma/client";

const log = createLogger("INTELLIGENCE:SVC_CHAT");

const AI_CONTAINER_URL = getContainerUrl();

/**
 * Create a new conversation.
 */
export async function createConversation(
  userId: string,
  walletId?: string,
): Promise<AIConversation> {
  return intelligenceRepository.createConversation({
    userId,
    walletId: walletId ?? null,
  });
}

/**
 * Get conversations for a user.
 */
export async function getConversations(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<AIConversation[]> {
  return intelligenceRepository.findConversationsByUser(userId, limit, offset);
}

/**
 * Get a conversation by ID with ownership check.
 */
export async function getConversation(
  conversationId: string,
  userId: string,
): Promise<AIConversation | null> {
  const conversation =
    await intelligenceRepository.findConversationById(conversationId);
  if (!conversation || conversation.userId !== userId) return null;
  return conversation;
}

/**
 * Get messages for a conversation.
 */
export async function getMessages(
  conversationId: string,
  limit = 100,
): Promise<AIMessage[]> {
  return intelligenceRepository.getMessages(conversationId, limit);
}

/**
 * Send a message and get AI response.
 */
export async function sendMessage(
  conversationId: string,
  userId: string,
  content: string,
  walletContext?: Record<string, unknown>,
): Promise<{ userMessage: AIMessage; assistantMessage: AIMessage }> {
  // Verify ownership
  const conversation =
    await intelligenceRepository.findConversationById(conversationId);
  if (!conversation || conversation.userId !== userId) {
    throw new Error("Conversation not found");
  }

  // Save user message
  const userMessage = await intelligenceRepository.addMessage({
    conversationId,
    role: "user",
    content,
  });

  // Get conversation history (last 20 messages for context window)
  const history = await intelligenceRepository.getMessages(conversationId, 20);

  // Build messages array for AI
  const aiMessages = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Call AI proxy
  const config = await getAIConfig();
  if (!config.enabled || !config.endpoint || !config.model) {
    const errorMsg = await intelligenceRepository.addMessage({
      conversationId,
      role: "assistant",
      content:
        "AI is not currently configured. Please set up an AI provider endpoint and model in the AI settings.",
    });
    return { userMessage, assistantMessage: errorMsg };
  }

  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/chat`, {
      method: "POST",
      headers: buildAIProxyJsonHeaders(),
      body: JSON.stringify({
        messages: aiMessages,
        walletContext,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      log.error("AI chat request failed", { status: response.status });
      const errorMsg = await intelligenceRepository.addMessage({
        conversationId,
        role: "assistant",
        content: "I was unable to process your request. Please try again.",
      });
      return { userMessage, assistantMessage: errorMsg };
    }

    const result = (await response.json()) as { response: string };

    const assistantMessage = await intelligenceRepository.addMessage({
      conversationId,
      role: "assistant",
      content: result.response,
    });

    // Auto-generate title from first message if conversation has no title
    /* v8 ignore next -- title generation is covered through conversation route behavior */
    if (!conversation.title && history.length <= 1) {
      const title =
        content.length > 60 ? content.substring(0, 57) + "..." : content;
      await intelligenceRepository.updateConversationTitle(
        conversationId,
        title,
      );
    }

    return { userMessage, assistantMessage };
  } catch (error) {
    log.error("AI chat error", { error: getErrorMessage(error) });
    const errorMsg = await intelligenceRepository.addMessage({
      conversationId,
      role: "assistant",
      content:
        "An error occurred while communicating with the AI. Please try again.",
    });
    return { userMessage, assistantMessage: errorMsg };
  }
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const conversation =
    await intelligenceRepository.findConversationById(conversationId);
  if (!conversation || conversation.userId !== userId) return false;

  await intelligenceRepository.deleteConversation(conversationId);
  return true;
}
