import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleDrawer } from "../../components/ConsoleDrawer";
import { ApiError } from "../../src/api/client";
import * as consoleApi from "../../src/api/console";

vi.mock("../../src/api/console", () => ({
  listConsoleTools: vi.fn(),
  listConsoleSessions: vi.fn(),
  createConsoleSession: vi.fn(),
  listConsoleTurns: vi.fn(),
  runConsoleTurn: vi.fn(),
  listPromptHistory: vi.fn(),
  updatePromptHistory: vi.fn(),
  deletePromptHistory: vi.fn(),
  replayPromptHistory: vi.fn(),
  getConsoleSetupReason: vi.fn((error: any) => {
    if (
      error?.status === 403 &&
      error?.response?.feature === "sanctuaryConsole"
    ) {
      return "feature-disabled";
    }
    if (
      error?.status === 503 &&
      typeof error?.message === "string" &&
      error.message.includes("AI provider is not configured")
    ) {
      return "provider-setup";
    }
    return null;
  }),
}));

const session = {
  id: "session-12345678",
  userId: "user-1",
  title: "Recent session",
  maxSensitivity: "wallet",
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:05:00.000Z",
};

const promptHistory = {
  id: "prompt-1",
  userId: "user-1",
  sessionId: session.id,
  prompt: "How long ago was block 800000?",
  title: "Block age",
  maxSensitivity: "wallet",
  saved: false,
  expiresAt: null,
  replayCount: 0,
  lastReplayedAt: null,
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:00:00.000Z",
};

const expiringPromptHistory = {
  ...promptHistory,
  id: "prompt-expiring",
  title: "",
  saved: true,
  expiresAt: "2026-05-26T01:00:00.000Z",
  updatedAt: "not-a-date",
};

const completedTurn = {
  id: "turn-1",
  sessionId: session.id,
  promptHistoryId: promptHistory.id,
  state: "completed",
  prompt: "How long ago was block 800000?",
  response: "Block 800000 was mined about 2 years ago.",
  maxSensitivity: "wallet",
  createdAt: "2026-04-26T01:00:00.000Z",
  completedAt: "2026-04-26T01:00:02.000Z",
};

const trace = {
  id: "trace-1",
  turnId: completedTurn.id,
  toolName: "read.block",
  status: "completed",
  sensitivity: "public",
  startedAt: "2026-04-26T01:00:00.000Z",
  completedAt: "2026-04-26T01:00:01.000Z",
  facts: { height: 800000 },
  provenance: [],
  redactions: [],
  truncation: null,
  errorMessage: null,
};

const olderSession = {
  ...session,
  id: "session-older",
  title: "",
  updatedAt: "2026-04-26T00:30:00.000Z",
};

const wallets = [
  { id: "wallet-1", name: "Main Vault", type: "single_sig" },
] as any;

const multiWallets = [
  { id: "wallet-1", name: "Main Vault", type: "single_sig" },
  { id: "wallet-2", name: "Spending", type: "single_sig" },
] as any;

function mockConsoleReadyState() {
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [],
  } as any);
  vi.mocked(consoleApi.listPromptHistory).mockResolvedValue({
    prompts: [promptHistory],
  } as any);
  vi.mocked(consoleApi.listConsoleTools).mockResolvedValue({
    tools: [
      {
        name: "read.block",
        title: "Read block",
        description: "Read block data",
        sensitivity: "public",
        requiredScope: "general",
        inputFields: ["height"],
        available: true,
        budgets: {},
      },
    ],
  } as any);
  vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
    turns: [],
  } as any);
  vi.mocked(consoleApi.runConsoleTurn).mockResolvedValue({
    session,
    turn: completedTurn,
    promptHistory,
    toolTraces: [],
  } as any);
  vi.mocked(consoleApi.replayPromptHistory).mockResolvedValue({
    session,
    turn: completedTurn,
    promptHistory: { ...promptHistory, replayCount: 1 },
    toolTraces: [],
  } as any);
  vi.mocked(consoleApi.updatePromptHistory).mockResolvedValue({
    prompt: { ...promptHistory, saved: true },
  } as any);
  vi.mocked(consoleApi.deletePromptHistory).mockResolvedValue({
    success: true,
  });
}

function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof ConsoleDrawer>> = {},
  options: {
    route?: string;
    onLocationChange?: (location: ReturnType<typeof useLocation>) => void;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={[options.route ?? "/"]}>
      <ConsoleDrawer
        isOpen
        onClose={vi.fn()}
        wallets={wallets}
        isAdmin
        {...overrides}
      />
      {options.onLocationChange ? (
        <LocationProbe onChange={options.onLocationChange} />
      ) : null}
    </MemoryRouter>,
  );
}

function LocationProbe({
  onChange,
}: {
  onChange: (location: ReturnType<typeof useLocation>) => void;
}) {
  const location = useLocation();
  useEffect(() => onChange(location), [location, onChange]);
  return null;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe("ConsoleDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleReadyState();
  });

  it("loads Console state and submits an auto-context prompt", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await screen.findByText("Block age");

    await user.type(
      screen.getByLabelText("Console prompt"),
      "How long ago was block 800000?",
    );
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith({
        prompt: "How long ago was block 800000?",
        clientContext: { mode: "auto" },
      });
    });
    expect(
      await screen.findByText("Block 800000 was mined about 2 years ago."),
    ).toBeInTheDocument();
  });

  it("keeps Auto selected and sends the current wallet route as context", async () => {
    const user = userEvent.setup();
    renderDrawer({}, { route: "/wallets/wallet-1" });

    await screen.findByText("Block age");
    await waitFor(() => {
      expect(screen.getByLabelText("Console context")).toHaveValue("auto");
    });

    await user.type(
      screen.getByLabelText("Console prompt"),
      "show me transactions between feb 2020 and june 2020",
    );
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith({
        prompt: "show me transactions between feb 2020 and june 2020",
        clientContext: { mode: "auto", routeWalletId: "wallet-1" },
      });
    });
  });

  it("submits prompts with an all-visible-wallets scope", async () => {
    const user = userEvent.setup();
    renderDrawer({ wallets: multiWallets });

    await screen.findByText("Block age");
    fireEvent.change(screen.getByLabelText("Console context"), {
      target: { value: "all-wallets" },
    });

    await user.type(
      screen.getByLabelText("Console prompt"),
      "summarize all wallets",
    );
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith({
        prompt: "summarize all wallets",
        scope: { kind: "wallet_set", walletIds: ["wallet-1", "wallet-2"] },
      });
    });
  });

  it("navigates to the wallet Transactions tab when Console queries transactions", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onLocationChange = vi.fn();
    vi.mocked(consoleApi.runConsoleTurn).mockResolvedValueOnce({
      session,
      promptHistory,
      toolTraces: [],
      turn: {
        ...completedTurn,
        plannedTools: {
          toolCalls: [
            {
              name: "query_transactions",
              input: {
                walletId: "wallet-1",
                dateFrom: "2020-02-01T00:00:00.000Z",
                dateTo: "2020-06-30T23:59:59.999Z",
              },
            },
          ],
        },
      },
    } as any);

    renderDrawer({ onClose }, { route: "/wallets/wallet-1", onLocationChange });
    await screen.findByText("Block age");

    await user.type(
      screen.getByLabelText("Console prompt"),
      "show me transactions between feb 2020 and june 2020",
    );
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      const locations = onLocationChange.mock.calls.map(
        ([location]) => location,
      );
      expect(
        locations.some(
          (location) =>
            location.pathname === "/wallets/wallet-1" &&
            location.state?.activeTab === "tx" &&
            location.state?.consoleTransactionFilter?.dateFrom ===
              "2020-02-01T00:00:00.000Z" &&
            location.state?.consoleTransactionFilter?.dateTo ===
              "2020-06-30T23:59:59.999Z",
        ),
      ).toBe(true);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("echoes submitted prompts while a Console turn is still running", async () => {
    const user = userEvent.setup();
    const turnResult =
      createDeferred<Awaited<ReturnType<typeof consoleApi.runConsoleTurn>>>();
    vi.mocked(consoleApi.runConsoleTurn).mockReturnValueOnce(
      turnResult.promise,
    );

    renderDrawer();
    await screen.findByText("Block age");

    await user.type(screen.getByLabelText("Console prompt"), "current block?");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    expect(await screen.findByText("current block?")).toBeInTheDocument();
    expect(screen.getByText("Working...")).toBeInTheDocument();

    turnResult.resolve({
      session,
      turn: {
        ...completedTurn,
        id: "turn-pending",
        prompt: "current block?",
        response: "The current block is 840000.",
      },
      promptHistory,
      toolTraces: [],
    } as any);

    expect(
      await screen.findByText("The current block is 840000."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Working...")).not.toBeInTheDocument();
    });
  });

  it("does not render when closed", () => {
    renderDrawer({ isOpen: false });

    expect(
      screen.queryByRole("dialog", { name: "Sanctuary Console" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the page backdrop transparent while the drawer surface is translucent", async () => {
    renderDrawer();
    await screen.findByText("Block age");

    expect(
      screen.getByRole("button", { name: "Close Console backdrop" }),
    ).toHaveClass("bg-transparent");
    expect(
      screen.getByRole("dialog", { name: "Sanctuary Console" }),
    ).toHaveClass("surface-flyout");
  });

  it("keeps the Console open for outside-click and Escape behavior while pinned", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderDrawer({ onClose });
    await screen.findByText("Block age");

    const pinButton = screen.getByRole("button", {
      name: "Pin Console open",
    });
    expect(pinButton).toHaveAttribute("aria-pressed", "false");

    await user.click(pinButton);

    const unpinButton = screen.getByRole("button", { name: "Unpin Console" });
    expect(unpinButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", { name: "Close Console backdrop" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Sanctuary Console" }),
    ).toHaveAttribute("aria-modal", "false");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close Console" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores no focus when no active element is available", async () => {
    const activeElementDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "activeElement",
    );
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      value: null,
    });

    try {
      renderDrawer();
      await screen.findByText("Block age");

      fireEvent.click(screen.getByRole("button", { name: "Close Console" }));
    } finally {
      if (activeElementDescriptor) {
        Object.defineProperty(
          document,
          "activeElement",
          activeElementDescriptor,
        );
      } else {
        delete (document as unknown as { activeElement?: Element | null })
          .activeElement;
      }
    }
  });

  it("handles session selection, wallet scope, keyboard send, prompt search, and close controls", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: undefined,
    });
    vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
      sessions: [olderSession, session],
    } as any);
    vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
      turns: [{ ...completedTurn, toolTraces: [trace] }],
    } as any);

    try {
      const view = renderDrawer({ onClose });

      await screen.findByText("Recent session");
      expect(screen.getByTitle("height: 800000")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Console session"), {
        target: { value: olderSession.id },
      });
      await waitFor(() => {
        expect(consoleApi.listConsoleTurns).toHaveBeenCalledWith(
          olderSession.id,
        );
      });

      view.rerender(
        <MemoryRouter>
          <ConsoleDrawer
            isOpen={false}
            onClose={onClose}
            wallets={wallets}
            isAdmin
          />
        </MemoryRouter>,
      );
      view.rerender(
        <MemoryRouter>
          <ConsoleDrawer isOpen onClose={onClose} wallets={wallets} isAdmin />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(screen.getByLabelText("Console session")).toHaveValue(
          olderSession.id,
        );
      });

      fireEvent.change(screen.getByLabelText("Console session"), {
        target: { value: "new-session" },
      });
      expect(screen.getByText("Ready")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Console context"), {
        target: { value: "wallet-1" },
      });
      await user.type(
        screen.getByLabelText("Console prompt"),
        "summarize this wallet",
      );
      fireEvent.keyDown(screen.getByLabelText("Console prompt"), {
        key: "Enter",
      });

      await waitFor(() => {
        expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith({
          prompt: "summarize this wallet",
          scope: { kind: "wallet", walletId: "wallet-1" },
        });
      });

      await user.type(screen.getByLabelText("Search prompt history"), "block");
      expect(screen.getByLabelText("Search prompt history")).toHaveValue(
        "block",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh prompt history" }),
      );
      await waitFor(() => {
        expect(consoleApi.listPromptHistory).toHaveBeenCalledWith({
          limit: 24,
          search: "block",
        });
      });

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole("button", { name: "Close Console backdrop" }),
      );
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(window, "requestAnimationFrame", {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
    }
  });

  it("falls back to auto context when a selected wallet disappears", async () => {
    const view = renderDrawer();
    await screen.findByText("Block age");

    fireEvent.change(screen.getByLabelText("Console context"), {
      target: { value: "wallet-1" },
    });
    expect(screen.getByLabelText("Console context")).toHaveValue("wallet-1");

    view.rerender(
      <MemoryRouter>
        <ConsoleDrawer isOpen onClose={vi.fn()} wallets={[]} isAdmin />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Console context")).toHaveValue("auto");
    });
  });

  it("falls back to auto context when all-visible-wallets has no wallets", async () => {
    const view = renderDrawer({ wallets: multiWallets });
    await screen.findByText("Block age");

    fireEvent.change(screen.getByLabelText("Console context"), {
      target: { value: "all-wallets" },
    });
    expect(screen.getByLabelText("Console context")).toHaveValue("all-wallets");

    view.rerender(
      <MemoryRouter>
        <ConsoleDrawer isOpen onClose={vi.fn()} wallets={[]} isAdmin />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Console context")).toHaveValue("auto");
    });
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

    vi.mocked(consoleApi.listPromptHistory).mockRejectedValueOnce(
      "network down",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh prompt history" }),
    );

    expect(
      await screen.findByText("Failed to load prompt history"),
    ).toBeInTheDocument();
  });

  it("keeps failed prompts in the dialogue with expandable details", async () => {
    const user = userEvent.setup();
    vi.mocked(consoleApi.runConsoleTurn).mockRejectedValueOnce(
      new ApiError("provider down", 503, {
        code: "SERVICE_UNAVAILABLE",
        details: { path: "/console/plan" },
        requestId: "request-1",
      }),
    );

    renderDrawer();
    await screen.findByText("Block age");

    await user.type(screen.getByLabelText("Console prompt"), "will fail");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    expect(await screen.findByText("will fail")).toBeInTheDocument();
    expect(await screen.findByText("provider down")).toBeInTheDocument();
    expect(screen.getByLabelText("Console prompt")).toHaveValue("");
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText(/HTTP status: 503/)).toBeInTheDocument();
    expect(screen.getByText(/request-1/)).toBeInTheDocument();
  });

  it("ignores empty prompt submissions", async () => {
    renderDrawer();
    await screen.findByText("Block age");

    fireEvent.keyDown(screen.getByLabelText("Console prompt"), {
      key: "Enter",
    });

    expect(consoleApi.runConsoleTurn).not.toHaveBeenCalled();
  });

  it("shows the feature flag state when the Console feature is disabled", async () => {
    vi.mocked(consoleApi.listConsoleSessions).mockRejectedValue(
      new ApiError("Console is disabled", 403, {
        feature: "sanctuaryConsole",
      }),
    );

    renderDrawer();

    expect(
      await screen.findByText("Console feature disabled"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Feature Flags" })).toHaveAttribute(
      "href",
      "/admin/feature-flags",
    );
  });

  it("hides the setup link for non-admin users", async () => {
    vi.mocked(consoleApi.listConsoleSessions).mockRejectedValue(
      new ApiError("Console is disabled", 403, {
        feature: "sanctuaryConsole",
      }),
    );

    renderDrawer({ isAdmin: false });

    expect(
      await screen.findByText("Console feature disabled"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Feature Flags" }),
    ).not.toBeInTheDocument();
  });

  it("shows the provider setup state when Console cannot reach AI setup", async () => {
    vi.mocked(consoleApi.runConsoleTurn).mockRejectedValueOnce(
      new ApiError("AI provider is not configured for Sanctuary Console", 503),
    );

    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText("Block age");

    await user.type(screen.getByLabelText("Console prompt"), "status");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    expect(
      await screen.findByText("AI provider setup required"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI Settings" })).toHaveAttribute(
      "href",
      "/admin/ai",
    );
  });
});
