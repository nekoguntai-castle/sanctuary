/**
 * Conversation Service Tests
 *
 * Tests for interactive AI chat conversation management.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const {
  mockGetAIConfig,
  mockSyncConfigToContainer,
  mockGetContainerUrl,
  mockRepo,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetAIConfig: vi.fn(),
  mockSyncConfigToContainer: vi.fn(),
  mockGetContainerUrl: vi.fn(() => "http://ai:3100"),
  mockRepo: {
    createConversation: vi.fn(),
    findConversationById: vi.fn(),
    findConversationsByUser: vi.fn(),
    updateConversationTitle: vi.fn(),
    deleteConversation: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn(),
  },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../../src/services/ai/config", () => ({
  getAIConfig: mockGetAIConfig,
  syncConfigToContainer: mockSyncConfigToContainer,
  getContainerUrl: mockGetContainerUrl,
}));

vi.mock("../../../../src/repositories/intelligenceRepository", () => ({
  intelligenceRepository: mockRepo,
}));

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: () => mockLogger,
}));

vi.mock("../../../../src/utils/errors", () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  createConversation,
  getConversations,
  getConversation,
  getMessages,
  sendMessage,
  deleteConversation,
} from "../../../../src/services/intelligence/conversationService";

describe("Conversation Service", () => {
  const now = new Date();

  const mockConversation = {
    id: "conv-1",
    userId: "user-1",
    walletId: "wallet-1",
    title: null,
    createdAt: now,
    updatedAt: now,
  };

  const mockUserMessage = {
    id: "msg-1",
    conversationId: "conv-1",
    role: "user",
    content: "What is my UTXO health?",
    metadata: null,
    createdAt: now,
  };

  const mockAssistantMessage = {
    id: "msg-2",
    conversationId: "conv-1",
    role: "assistant",
    content: "Your UTXO health looks good.",
    metadata: null,
    createdAt: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // createConversation
  // ========================================

  describe("createConversation", () => {
    it("should create a conversation with userId and walletId", async () => {
      (mockRepo.createConversation as Mock).mockResolvedValue(mockConversation);

      const result = await createConversation("user-1", "wallet-1");

      expect(result).toEqual(mockConversation);
      expect(mockRepo.createConversation).toHaveBeenCalledWith({
        userId: "user-1",
        walletId: "wallet-1",
      });
    });

    it("should create a conversation without walletId", async () => {
      const conv = { ...mockConversation, walletId: null };
      (mockRepo.createConversation as Mock).mockResolvedValue(conv);

      const result = await createConversation("user-1");

      expect(result).toEqual(conv);
      expect(mockRepo.createConversation).toHaveBeenCalledWith({
        userId: "user-1",
        walletId: null,
      });
    });
  });

  // ========================================
  // getConversations
  // ========================================

  describe("getConversations", () => {
    it("should return conversations for user with defaults", async () => {
      (mockRepo.findConversationsByUser as Mock).mockResolvedValue([
        mockConversation,
      ]);

      const result = await getConversations("user-1");

      expect(result).toEqual([mockConversation]);
      expect(mockRepo.findConversationsByUser).toHaveBeenCalledWith(
        "user-1",
        20,
        0,
      );
    });

    it("should pass custom limit and offset", async () => {
      (mockRepo.findConversationsByUser as Mock).mockResolvedValue([]);

      await getConversations("user-1", 5, 10);

      expect(mockRepo.findConversationsByUser).toHaveBeenCalledWith(
        "user-1",
        5,
        10,
      );
    });
  });

  // ========================================
  // getConversation
  // ========================================

  describe("getConversation", () => {
    it("should return conversation when user owns it", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );

      const result = await getConversation("conv-1", "user-1");

      expect(result).toEqual(mockConversation);
    });

    it("should return null when conversation not found", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(null);

      const result = await getConversation("nonexistent", "user-1");

      expect(result).toBeNull();
    });

    it("should return null when user does not own conversation", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );

      const result = await getConversation("conv-1", "other-user");

      expect(result).toBeNull();
    });
  });

  // ========================================
  // getMessages
  // ========================================

  describe("getMessages", () => {
    it("should return messages with default limit", async () => {
      (mockRepo.getMessages as Mock).mockResolvedValue([
        mockUserMessage,
        mockAssistantMessage,
      ]);

      const result = await getMessages("conv-1");

      expect(result).toEqual([mockUserMessage, mockAssistantMessage]);
      expect(mockRepo.getMessages).toHaveBeenCalledWith("conv-1", 100);
    });

    it("should accept custom limit", async () => {
      (mockRepo.getMessages as Mock).mockResolvedValue([]);

      await getMessages("conv-1", 10);

      expect(mockRepo.getMessages).toHaveBeenCalledWith("conv-1", 10);
    });
  });

  // ========================================
  // sendMessage
  // ========================================

  describe("sendMessage", () => {
    it("should send message and get AI response on happy path", async () => {
      // Ownership check
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );

      // Save user message
      (mockRepo.addMessage as Mock)
        .mockResolvedValueOnce(mockUserMessage) // user message
        .mockResolvedValueOnce(mockAssistantMessage); // assistant message

      // Get conversation history
      (mockRepo.getMessages as Mock).mockResolvedValue([mockUserMessage]);

      // AI config
      (mockGetAIConfig as Mock).mockResolvedValue({
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      });
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      // AI response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: "Your UTXO health looks good." }),
      });

      // Title update (first message, no title)
      (mockRepo.updateConversationTitle as Mock).mockResolvedValue({
        ...mockConversation,
        title: "What is my UTXO health?",
      });

      const result = await sendMessage(
        "conv-1",
        "user-1",
        "What is my UTXO health?",
      );

      expect(result.userMessage).toEqual(mockUserMessage);
      expect(result.assistantMessage).toEqual(mockAssistantMessage);
      expect(mockRepo.addMessage).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://ai:3100/chat",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-AI-Service-Secret": "",
          }),
        }),
      );
    });

    it("should return error message when AI is not configured", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );
      (mockRepo.addMessage as Mock)
        .mockResolvedValueOnce(mockUserMessage) // user message
        .mockResolvedValueOnce({
          ...mockAssistantMessage,
          content:
            "AI is not currently configured. Please set up an AI provider endpoint and model in the AI settings.",
        }); // error message

      (mockRepo.getMessages as Mock).mockResolvedValue([mockUserMessage]);

      (mockGetAIConfig as Mock).mockResolvedValue({
        enabled: false,
        endpoint: null,
        model: null,
      });

      const result = await sendMessage("conv-1", "user-1", "Hello");

      expect(result.userMessage).toEqual(mockUserMessage);
      expect(result.assistantMessage.content).toContain(
        "AI is not currently configured",
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should throw when conversation not found", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(null);

      await expect(
        sendMessage("nonexistent", "user-1", "Hello"),
      ).rejects.toThrow("Conversation not found");
    });

    it("should throw when user does not own conversation", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );

      await expect(
        sendMessage("conv-1", "other-user", "Hello"),
      ).rejects.toThrow("Conversation not found");
    });

    it("should return error message when AI chat request fails", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );
      (mockRepo.addMessage as Mock)
        .mockResolvedValueOnce(mockUserMessage) // user message
        .mockResolvedValueOnce({
          ...mockAssistantMessage,
          content: "I was unable to process your request. Please try again.",
        }); // error message

      (mockRepo.getMessages as Mock).mockResolvedValue([mockUserMessage]);

      (mockGetAIConfig as Mock).mockResolvedValue({
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      });
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await sendMessage("conv-1", "user-1", "Hello");

      expect(result.assistantMessage.content).toContain("unable to process");
    });

    it("should return error message when fetch throws", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );
      (mockRepo.addMessage as Mock)
        .mockResolvedValueOnce(mockUserMessage) // user message
        .mockResolvedValueOnce({
          ...mockAssistantMessage,
          content:
            "An error occurred while communicating with the AI. Please try again.",
        }); // error message

      (mockRepo.getMessages as Mock).mockResolvedValue([mockUserMessage]);

      (mockGetAIConfig as Mock).mockResolvedValue({
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      });
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await sendMessage("conv-1", "user-1", "Hello");

      expect(result.assistantMessage.content).toContain("error occurred");
    });

    it("should auto-generate title from first message content", async () => {
      const convNoTitle = { ...mockConversation, title: null };
      (mockRepo.findConversationById as Mock).mockResolvedValue(convNoTitle);
      (mockRepo.addMessage as Mock)
        .mockResolvedValueOnce(mockUserMessage)
        .mockResolvedValueOnce(mockAssistantMessage);

      // Only 1 message in history (the one we just added)
      (mockRepo.getMessages as Mock).mockResolvedValue([mockUserMessage]);

      (mockGetAIConfig as Mock).mockResolvedValue({
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      });
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: "Answer" }),
      });

      (mockRepo.updateConversationTitle as Mock).mockResolvedValue(convNoTitle);

      await sendMessage("conv-1", "user-1", "What is my UTXO health?");

      expect(mockRepo.updateConversationTitle).toHaveBeenCalledWith(
        "conv-1",
        "What is my UTXO health?",
      );
    });

    it("should truncate long titles to 60 characters", async () => {
      const convNoTitle = { ...mockConversation, title: null };
      (mockRepo.findConversationById as Mock).mockResolvedValue(convNoTitle);

      const longContent = "A".repeat(100);
      const userMsg = { ...mockUserMessage, content: longContent };
      (mockRepo.addMessage as Mock)
        .mockResolvedValueOnce(userMsg)
        .mockResolvedValueOnce(mockAssistantMessage);

      (mockRepo.getMessages as Mock).mockResolvedValue([userMsg]);

      (mockGetAIConfig as Mock).mockResolvedValue({
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      });
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: "Answer" }),
      });

      (mockRepo.updateConversationTitle as Mock).mockResolvedValue(convNoTitle);

      await sendMessage("conv-1", "user-1", longContent);

      expect(mockRepo.updateConversationTitle).toHaveBeenCalledWith(
        "conv-1",
        "A".repeat(57) + "...",
      );
    });
  });

  // ========================================
  // deleteConversation
  // ========================================

  describe("deleteConversation", () => {
    it("should delete conversation when user owns it", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );
      (mockRepo.deleteConversation as Mock).mockResolvedValue(undefined);

      const result = await deleteConversation("conv-1", "user-1");

      expect(result).toBe(true);
      expect(mockRepo.deleteConversation).toHaveBeenCalledWith("conv-1");
    });

    it("should return false when conversation not found", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(null);

      const result = await deleteConversation("nonexistent", "user-1");

      expect(result).toBe(false);
      expect(mockRepo.deleteConversation).not.toHaveBeenCalled();
    });

    it("should return false when user does not own conversation", async () => {
      (mockRepo.findConversationById as Mock).mockResolvedValue(
        mockConversation,
      );

      const result = await deleteConversation("conv-1", "other-user");

      expect(result).toBe(false);
      expect(mockRepo.deleteConversation).not.toHaveBeenCalled();
    });
  });
});
