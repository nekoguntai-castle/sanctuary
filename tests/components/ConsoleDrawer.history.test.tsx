import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import {
  completedTurn,
  consoleApi,
  expiringPromptHistory,
  mockConsoleReadyState,
  renderDrawer,
  session,
} from "./ConsoleDrawer.testUtils";

vi.mock("../../src/api/console", async () => {
  const { createConsoleApiMock } = await import("./ConsoleDrawer.apiMock");
  return createConsoleApiMock();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockConsoleReadyState();
});

it("clears a selected Console session after confirmation", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [session],
  } as any);
  vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
    turns: [completedTurn],
  } as any);

  try {
    renderDrawer();
    expect(
      await screen.findByText("Block 800000 was mined about 2 years ago."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear selected Console session",
      }),
    );

    await waitFor(() => {
      expect(consoleApi.deleteConsoleSession).toHaveBeenCalledWith(session.id);
    });
    expect(screen.getByLabelText("Console session")).toHaveValue("new-session");
    expect(
      screen.queryByText("Block 800000 was mined about 2 years ago."),
    ).not.toBeInTheDocument();
  } finally {
    confirmSpy.mockRestore();
  }
});

it("keeps a selected Console session when clear confirmation is canceled", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [session],
  } as any);
  vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
    turns: [completedTurn],
  } as any);

  try {
    renderDrawer();
    expect(
      await screen.findByText("Block 800000 was mined about 2 years ago."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear selected Console session",
      }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      "Clear the selected Console session? Prompt history is not removed.",
    );
    expect(consoleApi.deleteConsoleSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Console session")).toHaveValue(session.id);
    expect(
      screen.getByText("Block 800000 was mined about 2 years ago."),
    ).toBeInTheDocument();
  } finally {
    confirmSpy.mockRestore();
  }
});

it("keeps a selected Console session and shows an error when clearing fails", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [session],
  } as any);
  vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
    turns: [completedTurn],
  } as any);
  vi.mocked(consoleApi.deleteConsoleSession).mockRejectedValueOnce(
    new ApiError("Session clear failed", 500),
  );

  try {
    renderDrawer();
    expect(
      await screen.findByText("Block 800000 was mined about 2 years ago."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear selected Console session",
      }),
    );

    expect(await screen.findByText("Session clear failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Console session")).toHaveValue(session.id);
    expect(
      screen.getByText("Block 800000 was mined about 2 years ago."),
    ).toBeInTheDocument();
  } finally {
    confirmSpy.mockRestore();
  }
});

it("replays, saves, expires, and deletes prompt history rows", async () => {
  renderDrawer();
  await screen.findByText("Block age");

  fireEvent.click(screen.getByRole("button", { name: "Replay prompt" }));
  await waitFor(() => {
    expect(consoleApi.replayPromptHistory).toHaveBeenCalledWith("prompt-1", {
      clientContext: { mode: "auto" },
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Save prompt" }));
  await waitFor(() => {
    expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith("prompt-1", {
      saved: true,
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Expire in 30 days" }));
  await waitFor(() => {
    expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith("prompt-1", {
      expiresAt: expect.any(String),
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Delete prompt" }));
  await waitFor(() => {
    expect(consoleApi.deletePromptHistory).toHaveBeenCalledWith("prompt-1");
  });
});

it("clears prompt history after confirmation", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

  try {
    renderDrawer();
    await screen.findByText("Block age");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear prompt history" }),
    );

    await waitFor(() => {
      expect(consoleApi.clearPromptHistory).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Block age")).not.toBeInTheDocument();
    expect(screen.getByText("No prompt history")).toBeInTheDocument();
  } finally {
    confirmSpy.mockRestore();
  }
});

it("keeps prompt history when clear confirmation is canceled", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

  try {
    renderDrawer();
    await screen.findByText("Block age");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear prompt history" }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      "Clear Console prompt history? Saved prompts will also be removed.",
    );
    expect(consoleApi.clearPromptHistory).not.toHaveBeenCalled();
    expect(screen.getByText("Block age")).toBeInTheDocument();
  } finally {
    confirmSpy.mockRestore();
  }
});

it("keeps prompt history and shows an error when clearing history fails", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(consoleApi.clearPromptHistory).mockRejectedValueOnce(
    new ApiError("Prompt history clear failed", 500),
  );

  try {
    renderDrawer();
    await screen.findByText("Block age");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear prompt history" }),
    );

    expect(
      await screen.findByText("Prompt history clear failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Block age")).toBeInTheDocument();
    expect(screen.queryByText("No prompt history")).not.toBeInTheDocument();
  } finally {
    confirmSpy.mockRestore();
  }
});

it("replays prompt history with an explicit wallet scope", async () => {
  renderDrawer();
  await screen.findByText("Block age");

  fireEvent.change(screen.getByLabelText("Console context"), {
    target: { value: "wallet-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Replay prompt" }));

  await waitFor(() => {
    expect(consoleApi.replayPromptHistory).toHaveBeenCalledWith("prompt-1", {
      scope: { kind: "wallet", walletId: "wallet-1" },
    });
  });
});

it("clears expiration and unsaves prompts with existing expiration metadata", async () => {
  vi.mocked(consoleApi.listPromptHistory).mockResolvedValue({
    prompts: [expiringPromptHistory],
  } as any);
  vi.mocked(consoleApi.updatePromptHistory).mockResolvedValue({
    prompt: expiringPromptHistory,
  } as any);

  renderDrawer();
  await screen.findByText("How long ago was block 800000?");

  fireEvent.click(screen.getByRole("button", { name: "Unsave prompt" }));
  await waitFor(() => {
    expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith(
      "prompt-expiring",
      { saved: false },
    );
  });

  fireEvent.click(screen.getByRole("button", { name: "Clear expiration" }));
  await waitFor(() => {
    expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith(
      "prompt-expiring",
      { expiresAt: null },
    );
  });
});

it("surfaces operation errors without dropping prompt history rows", async () => {
  vi.mocked(consoleApi.replayPromptHistory).mockRejectedValueOnce(
    new Error("replay broke"),
  );
  vi.mocked(consoleApi.updatePromptHistory)
    .mockRejectedValueOnce(new Error("save broke"))
    .mockRejectedValueOnce(new Error("expire broke"));
  vi.mocked(consoleApi.deletePromptHistory).mockRejectedValueOnce(
    new Error("delete broke"),
  );

  renderDrawer();
  await screen.findByText("Block age");

  fireEvent.click(screen.getByRole("button", { name: "Replay prompt" }));
  expect(await screen.findByText("replay broke")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Save prompt" }));
  expect(await screen.findByText("save broke")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Expire in 30 days" }));
  expect(await screen.findByText("expire broke")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Delete prompt" }));
  expect(await screen.findByText("delete broke")).toBeInTheDocument();
  expect(screen.getByText("Block age")).toBeInTheDocument();
});

it("surfaces prompt refresh and session-turn load errors", async () => {
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [session],
  } as any);
  vi.mocked(consoleApi.listConsoleTurns).mockRejectedValueOnce(
    new Error("turns unavailable"),
  );

  renderDrawer();

  expect(await screen.findByText("turns unavailable")).toBeInTheDocument();

  vi.mocked(consoleApi.listPromptHistory).mockRejectedValueOnce("network down");
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh prompt history" }),
  );

  expect(
    await screen.findByText("Failed to load prompt history"),
  ).toBeInTheDocument();
});
