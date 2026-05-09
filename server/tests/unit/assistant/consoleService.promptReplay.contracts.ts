import { expect, it } from "vitest";
import {
  actor,
  mocks,
  promptHistory,
  promptId,
  sessionId,
  walletId,
} from "./consoleService.testUtils";
import { replayPromptHistory } from "../../../src/assistant/console/service";

export function registerConsolePromptReplayTests(): void {
  it("replays stored prompts with explicit replay overrides", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory({
        sessionId: null,
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    );
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await replayPromptHistory(actor(true), promptId, {
      sessionId,
      scope: { kind: "admin" },
      maxSensitivity: "admin",
      expiresAt: "2026-04-27T00:00:00.000Z",
    });

    expect(mocks.consoleRepository.updateSessionScope).toHaveBeenCalledWith(
      sessionId,
      { kind: "admin" },
      "admin",
    );
    expect(mocks.consoleRepository.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date("2026-04-27T00:00:00.000Z"),
      }),
    );
  });

  it("replays prompt history with auto context instead of the stored scope", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory({
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    );
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await replayPromptHistory(actor(), promptId, {
      clientContext: { mode: "auto", routeWalletId: walletId },
    });

    expect(mocks.consoleRepository.updateSessionScope).toHaveBeenCalledWith(
      sessionId,
      { kind: "wallet_set", walletIds: [walletId] },
      "wallet",
    );
    expect(mocks.planConsoleTools).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          mode: "auto",
          currentWalletId: walletId,
        }),
      }),
    );
  });

  it("replays prompt history without a stored session when no override is supplied", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory({ sessionId: null }),
    );
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await replayPromptHistory(actor(), promptId, {});

    expect(mocks.consoleRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
      }),
    );
  });
}
