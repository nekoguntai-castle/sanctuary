import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ANALYSIS_TIMEOUT_MS } from "../../ai-proxy/src/constants";

const mocks = vi.hoisted(() => ({
  callExternalAIWithMessagesResult: vi.fn(),
  parseStructuredResponse: vi.fn(),
}));

vi.mock("../../ai-proxy/src/aiClient", () => ({
  callExternalAIWithMessagesResult: mocks.callExternalAIWithMessagesResult,
  parseStructuredResponse: mocks.parseStructuredResponse,
}));

import {
  buildNaturalQueryPrompt,
  convertNaturalQuery,
} from "../../ai-proxy/src/naturalQuery";

const aiConfig = {
  enabled: true,
  endpoint: "http://lmstudio.local:1234/v1",
  model: "qwen3",
  providerType: "openai-compatible",
};
const walletId = "da17d9d4-c760-4929-a207-2a45c3cadef9";

describe("natural query conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseStructuredResponse.mockImplementation((raw: string) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    });
  });

  it("uses the Console planner path and longer analysis timeout for local transaction filters", async () => {
    mocks.callExternalAIWithMessagesResult.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        toolCalls: [
          {
            name: "query_transactions",
            input: { walletId, confirmations: 0 },
          },
        ],
      }),
    });

    const result = await convertNaturalQuery({
      aiConfig,
      query: "what is unconfirmed?",
      walletId,
      recentLabels: "Exchange",
    });

    expect(result).toEqual({
      ok: true,
      query: { type: "transactions", filter: { confirmations: 0 } },
    });
    expect(mocks.callExternalAIWithMessagesResult).toHaveBeenCalledWith(
      aiConfig,
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Sanctuary Console's planning model"),
        }),
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("what is unconfirmed?"),
        }),
      ]),
      {
        timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
        temperature: 0,
        maxTokens: 512,
        allowReasoningContent: true,
      },
    );
  });

  it("includes known wallet labels in the model prompt", () => {
    expect(
      buildNaturalQueryPrompt({
        query: "show exchange sends",
        recentLabels: "Exchange, Payroll",
      }),
    ).toContain("Exchange, Payroll");
  });

  it("returns an unavailable conversion result when the model call fails", async () => {
    mocks.callExternalAIWithMessagesResult.mockResolvedValue({
      ok: false,
      reason: "timeout",
      message: "AI endpoint request timed out",
    });

    await expect(
      convertNaturalQuery({
        aiConfig,
        query: "latest",
        walletId,
        recentLabels: "None",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      error: "AI endpoint not available",
    });
  });

  it("returns a parse failure with a bounded preview for invalid model output", async () => {
    mocks.callExternalAIWithMessagesResult.mockResolvedValue({
      ok: true,
      content: "not json",
    });
    mocks.parseStructuredResponse.mockReturnValue(null);

    await expect(
      convertNaturalQuery({
        aiConfig,
        query: "latest",
        walletId,
        recentLabels: "None",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 500,
      error: "AI did not return valid JSON",
      preview: "not json",
    });
  });

  it("applies the same transaction date fallback as the Console planner", async () => {
    mocks.callExternalAIWithMessagesResult.mockResolvedValue({
      ok: true,
      content: "I should retrieve the transactions from the selected wallet.",
    });
    mocks.parseStructuredResponse.mockReturnValue(null);

    await expect(
      convertNaturalQuery({
        aiConfig,
        query: "show me transactions between feb 2020 and june 2020",
        walletId,
        recentLabels: "None",
      }),
    ).resolves.toEqual({
      ok: true,
      query: {
        type: "transactions",
        filter: {
          dateFrom: "2020-02-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
        },
      },
    });
  });
});
