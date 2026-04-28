import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ConsoleDrawer } from "../../components/ConsoleDrawer";
import {
  completedTurn,
  consoleApi,
  createDeferred,
  mockConsoleReadyState,
  multiWallets,
  olderSession,
  promptHistory,
  renderDrawer,
  session,
  trace,
  wallets,
} from "./ConsoleDrawer.testUtils";

vi.mock("../../src/api/console", async () => {
  const { createConsoleApiMock } = await import("./ConsoleDrawer.apiMock");
  return createConsoleApiMock();
});

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
    const locations = onLocationChange.mock.calls.map(([location]) => location);
    const walletLocations = locations.filter(
      (location) => location.pathname === "/wallets/wallet-1",
    );
    const transactionLocation = walletLocations.at(-1);
    expect(transactionLocation?.state?.activeTab).toBe("tx");
    expect(transactionLocation?.state?.consoleTransactionFilter).toMatchObject({
      dateFrom: "2020-02-01T00:00:00.000Z",
      dateTo: "2020-06-30T23:59:59.999Z",
    });
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("navigates to AI Results when all-visible-wallet planning returns multiple transaction queries", async () => {
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
              dateFrom: "2020-02-01",
              dateTo: "2020-06-30",
            },
          },
          {
            name: "query_transactions",
            input: {
              walletId: "wallet-2",
              dateFrom: "2020-02-01",
              dateTo: "2020-06-30",
            },
          },
        ],
      },
    },
  } as any);

  renderDrawer(
    { wallets: multiWallets, onClose },
    { route: "/wallets/wallet-1", onLocationChange },
  );
  await screen.findByText("Block age");

  fireEvent.change(screen.getByLabelText("Console context"), {
    target: { value: "all-wallets" },
  });
  await user.type(
    screen.getByLabelText("Console prompt"),
    "show me transactions between feb 2020 and june 2020",
  );
  await user.click(screen.getByRole("button", { name: "Send prompt" }));

  await waitFor(() => {
    expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith({
      prompt: "show me transactions between feb 2020 and june 2020",
      scope: { kind: "wallet_set", walletIds: ["wallet-1", "wallet-2"] },
    });
  });
  await waitFor(() => {
    const locations = onLocationChange.mock.calls.map(([location]) => location);
    expect(
      locations.some(
        (location) =>
          location.pathname === "/console/results" &&
          location.state?.consoleTransactionQuery?.walletFilters?.length === 2,
      ),
    ).toBe(true);
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps a pinned Console open after transaction navigation", async () => {
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
              dateFrom: "2020-02-01",
              type: "sent",
            },
          },
        ],
      },
    },
  } as any);

  renderDrawer({ onClose }, { route: "/wallets/wallet-1", onLocationChange });
  await screen.findByText("Block age");

  await user.click(screen.getByRole("button", { name: "Pin Console open" }));
  await user.type(
    screen.getByLabelText("Console prompt"),
    "show sent transactions in february",
  );
  await user.click(screen.getByRole("button", { name: "Send prompt" }));

  await waitFor(() => {
    const locations = onLocationChange.mock.calls.map(([location]) => location);
    expect(
      locations.some(
        (location) =>
          location.pathname === "/wallets/wallet-1" &&
          location.state?.activeTab === "tx" &&
          location.state?.consoleTransactionFilter?.type === "sent",
      ),
    ).toBe(true);
  });
  expect(onClose).not.toHaveBeenCalled();
});

it("echoes submitted prompts while a Console turn is still running", async () => {
  const user = userEvent.setup();
  const turnResult =
    createDeferred<Awaited<ReturnType<typeof consoleApi.runConsoleTurn>>>();
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [session],
  } as any);
  vi.mocked(consoleApi.runConsoleTurn).mockReturnValueOnce(turnResult.promise);

  renderDrawer();
  await screen.findByText("Block age");

  await user.type(screen.getByLabelText("Console prompt"), "current block?");
  await user.click(screen.getByRole("button", { name: "Send prompt" }));

  expect(await screen.findByText("current block?")).toBeInTheDocument();
  expect(
    screen.getByRole("status", { name: "LLM is thinking" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Working...")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Clear Console display" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", {
      name: "Clear selected Console session",
    }),
  ).toBeDisabled();

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
  expect(
    screen.queryByRole("status", { name: "LLM is thinking" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Clear Console display" }),
  ).not.toBeDisabled();
});

it("clears the visible Console display without deleting the session", async () => {
  const user = userEvent.setup();
  renderDrawer();
  await screen.findByText("Block age");

  await user.type(screen.getByLabelText("Console prompt"), "current block?");
  await user.click(screen.getByRole("button", { name: "Send prompt" }));
  expect(
    await screen.findByText("Block 800000 was mined about 2 years ago."),
  ).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "Clear Console display" }),
  );

  expect(
    screen.queryByText("Block 800000 was mined about 2 years ago."),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Ready")).toBeInTheDocument();
  expect(consoleApi.deleteConsoleSession).not.toHaveBeenCalled();
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
  expect(screen.getByRole("dialog", { name: "Sanctuary Console" })).toHaveClass(
    "surface-flyout",
  );
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
      Object.defineProperty(document, "activeElement", activeElementDescriptor);
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
      expect(consoleApi.listConsoleTurns).toHaveBeenCalledWith(olderSession.id);
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
    expect(screen.getByLabelText("Search prompt history")).toHaveValue("block");
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

it("ignores empty prompt submissions", async () => {
  renderDrawer();
  await screen.findByText("Block age");

  fireEvent.keyDown(screen.getByLabelText("Console prompt"), {
    key: "Enter",
  });

  expect(consoleApi.runConsoleTurn).not.toHaveBeenCalled();
});
