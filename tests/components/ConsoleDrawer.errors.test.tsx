import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import {
  consoleApi,
  mockConsoleReadyState,
  renderDrawer,
} from "./ConsoleDrawer.testUtils";

vi.mock("../../src/api/console", async () => {
  const { createConsoleApiMock } = await import("./ConsoleDrawer.apiMock");
  return createConsoleApiMock();
});

describe("ConsoleDrawer error and setup states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleReadyState();
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

  it("keeps timed-out local provider prompts in the dialogue with diagnostics", async () => {
    const user = userEvent.setup();
    vi.mocked(consoleApi.runConsoleTurn).mockRejectedValueOnce(
      new ApiError("The request took too long to process", 408, {
        details: { path: "/console/plan", provider: "lm-studio" },
        requestId: "request-408",
      }),
    );

    renderDrawer();
    await screen.findByText("Block age");

    await user.type(
      screen.getByLabelText("Console prompt"),
      "whats the current block?",
    );
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    expect(
      await screen.findByText("whats the current block?"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("The request took too long to process"),
    ).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText(/HTTP status: 408/)).toBeInTheDocument();
    expect(screen.getByText(/request-408/)).toBeInTheDocument();
    expect(screen.getByText(/lm-studio/)).toBeInTheDocument();
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
      new ApiError("provider setup failed", 503, {
        details: { reason: "provider_not_configured" },
      }),
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
