import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ContainerControls } from "../../components/AISettings/components/ContainerControls";
import { EnableModal } from "../../components/AISettings/components/EnableModal";
import { McpAccessTab } from "../../components/AISettings/tabs/McpAccessTab";
import { ModelsTab } from "../../components/AISettings/tabs/ModelsTab";
import { ModelSelectionControls } from "../../components/AISettings/tabs/SettingsTabModelControls";
import { SettingsTab } from "../../components/AISettings/tabs/SettingsTab";
import { StatusTab } from "../../components/AISettings/tabs/StatusTab";

describe("EnableModal", () => {
  const baseProps = {
    showEnableModal: true,
    onClose: vi.fn(),
    onEnable: vi.fn(),
  };

  it("renders nothing when hidden", () => {
    const { container } = render(
      <EnableModal {...baseProps} showEnableModal={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows deployment options info when modal is open", () => {
    render(<EnableModal {...baseProps} />);
    expect(screen.getAllByText(/bundled ollama/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/host ollama/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/openai-compatible server/i).length,
    ).toBeGreaterThan(0);
  });

  it("always enables the Enable AI button (resource check removed)", () => {
    render(<EnableModal {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /enable ai/i }),
    ).not.toBeDisabled();
  });

  it("shows after-enable hint about configuring endpoint", () => {
    render(<EnableModal {...baseProps} />);
    expect(screen.getByText(/settings/i)).toBeInTheDocument();
  });

  it("enables actions for sufficient resources and handles close/enable actions", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onEnable = vi.fn();
    const props = {
      ...baseProps,
      onClose,
      onEnable,
    };

    render(<EnableModal {...props} />);

    await user.click(screen.getByRole("button", { name: /enable ai/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onEnable).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ModelsTab", () => {
  const baseProps = {
    providerType: "ollama" as const,
    aiModel: "",
    pullProgress: "",
    downloadProgress: null,
    isPulling: false,
    pullModelName: "",
    customModelName: "",
    isLoadingPopularModels: false,
    popularModelsError: null,
    popularModels: [] as any[],
    availableModels: [] as any[],
    isLoadingModels: false,
    isDeleting: false,
    deleteModelName: "",
    onSelectModel: vi.fn(),
    onRefreshModels: vi.fn(),
    onPullModel: vi.fn(),
    onDeleteModel: vi.fn(),
    onCustomModelNameChange: vi.fn(),
    onLoadPopularModels: vi.fn(),
    formatBytes: (bytes: number) => `${bytes}B`,
  };

  it("renders loading and error states for popular models", async () => {
    const user = userEvent.setup();
    const onLoadPopularModels = vi.fn();
    const { rerender } = render(
      <ModelsTab
        {...baseProps}
        isLoadingPopularModels={true}
        onLoadPopularModels={onLoadPopularModels}
      />,
    );
    expect(screen.getByText(/loading popular models/i)).toBeInTheDocument();

    rerender(
      <ModelsTab
        {...baseProps}
        isLoadingPopularModels={false}
        popularModelsError="Failed to load"
        onLoadPopularModels={onLoadPopularModels}
      />,
    );
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(onLoadPopularModels).toHaveBeenCalled();
  });

  it("renders installed and installable popular models with action buttons", async () => {
    const user = userEvent.setup();
    const onPullModel = vi.fn();
    const onDeleteModel = vi.fn();
    render(
      <ModelsTab
        {...baseProps}
        popularModels={[
          { name: "llama3", description: "Main model", recommended: true },
          { name: "phi3", description: "Small model" },
        ]}
        availableModels={[{ name: "llama3", size: 1 } as any]}
        onPullModel={onPullModel}
        onDeleteModel={onDeleteModel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getAllByRole("button", { name: /pull/i })[0]);

    expect(screen.getAllByText(/recommended/i).length).toBeGreaterThan(0);
    expect(onDeleteModel).toHaveBeenCalledWith("llama3");
    expect(onPullModel).toHaveBeenCalledWith("phi3");
  });

  it("renders OpenAI-compatible detected models without pull or delete actions", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    render(
      <ModelsTab
        {...baseProps}
        providerType="openai-compatible"
        aiModel="lmstudio/model-a"
        popularModels={[{ name: "qwen3:4b", description: "Balanced" }]}
        availableModels={[{ name: "lmstudio/model-a", size: 0 } as any]}
        onSelectModel={onSelectModel}
      />,
    );

    expect(screen.getByText("Detected Provider Models")).toBeInTheDocument();
    expect(screen.getByText("lmstudio/model-a")).toBeInTheDocument();
    expect(
      screen.getByText(/LM Studio and other OpenAI-compatible/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^pull$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /selected/i }));
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("handles custom model pull flow and download progress display", async () => {
    const user = userEvent.setup();
    const onPullModel = vi.fn();
    const onCustomModelNameChange = vi.fn();

    render(
      <ModelsTab
        {...baseProps}
        pullProgress="Pulling..."
        pullModelName="mistral"
        customModelName="  mistral:7b  "
        downloadProgress={
          {
            status: "downloading",
            percent: 50,
            completed: 500,
            total: 1000,
          } as any
        }
        onPullModel={onPullModel}
        onCustomModelNameChange={onCustomModelNameChange}
      />,
    );

    expect(screen.getByText(/downloading mistral/i)).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^pull$/i })[0]);
    expect(onPullModel).toHaveBeenCalledWith("mistral:7b");
    expect(onCustomModelNameChange).toHaveBeenCalledWith("");
  });

  it("renders success progress style and pulling/verifying status labels", () => {
    const { rerender } = render(
      <ModelsTab {...baseProps} pullProgress="Successfully pulled model" />,
    );

    expect(screen.getByText("Successfully pulled model")).toBeInTheDocument();

    rerender(
      <ModelsTab
        {...baseProps}
        pullProgress="Working..."
        downloadProgress={
          { status: "pulling", percent: 0, completed: 0, total: 0 } as any
        }
      />,
    );
    expect(screen.getByText("Pulling manifest...")).toBeInTheDocument();

    rerender(
      <ModelsTab
        {...baseProps}
        pullProgress="Working..."
        downloadProgress={
          { status: "verifying", percent: 0, completed: 0, total: 0 } as any
        }
      />,
    );
    expect(screen.getByText("Verifying...")).toBeInTheDocument();
  });

  it("shows delete spinner for the model currently being deleted", () => {
    render(
      <ModelsTab
        {...baseProps}
        popularModels={[{ name: "llama3", description: "Main model" }]}
        availableModels={[{ name: "llama3", size: 1 } as any]}
        isDeleting={true}
        deleteModelName="llama3"
      />,
    );

    const deleteButton = screen.getByRole("button", { name: /delete/i });
    expect(deleteButton.querySelector(".animate-spin")).not.toBeNull();
  });

  it("does not trigger custom pull handlers when custom model name is blank (manual click handler path)", () => {
    const onPullModel = vi.fn();
    const onCustomModelNameChange = vi.fn();

    const element = ModelsTab({
      ...baseProps,
      customModelName: "   ",
      onPullModel,
      onCustomModelNameChange,
    });

    function findCustomPullButton(node: any): any {
      if (!node || typeof node !== "object") return null;
      if (
        node.type === "button" &&
        typeof node.props?.className === "string" &&
        node.props.className.includes("px-4 py-2")
      ) {
        return node;
      }
      const children = React.Children.toArray(node.props?.children);
      for (const child of children) {
        const found = findCustomPullButton(child);
        if (found) return found;
      }
      return null;
    }

    const customPullButton = findCustomPullButton(element);
    expect(customPullButton).not.toBeNull();
    expect(typeof customPullButton.props.onClick).toBe("function");

    act(() => {
      customPullButton.props.onClick();
    });

    expect(onPullModel).not.toHaveBeenCalled();
    expect(onCustomModelNameChange).not.toHaveBeenCalled();
  });
});

describe("SettingsTab", () => {
  const baseProps = {
    providerProfiles: [
      {
        id: "default-ollama",
        name: "Default Ollama",
        providerType: "ollama" as const,
        endpoint: "",
        model: "",
        capabilities: { chat: true, toolCalls: false, strictJson: true },
      },
    ],
    activeProviderProfileId: "default-ollama",
    providerName: "Default Ollama",
    providerType: "ollama" as const,
    providerCapabilities: { chat: true, toolCalls: false, strictJson: true },
    credentialStatusText: "No credential",
    credentialApiKey: "",
    clearCredential: false,
    aiEndpoint: "",
    aiModel: "",
    isSaving: false,
    isDetecting: false,
    detectMessage: "",
    showModelDropdown: false,
    availableModels: [] as any[],
    isLoadingModels: false,
    aiStatus: "idle" as const,
    aiStatusMessage: "",
    saveSuccess: false,
    saveError: null,
    onSelectProviderProfile: vi.fn(),
    onAddProviderProfile: vi.fn(),
    onRemoveActiveProviderProfile: vi.fn(),
    onProviderNameChange: vi.fn(),
    onProviderTypeChange: vi.fn(),
    onProviderCapabilityChange: vi.fn(),
    onCredentialApiKeyChange: vi.fn(),
    onClearCredentialChange: vi.fn(),
    onEndpointChange: vi.fn(),
    onDetectOllama: vi.fn(),
    onModelChange: vi.fn(),
    onSelectModel: vi.fn(),
    onToggleModelDropdown: vi.fn(),
    onSaveConfig: vi.fn(),
    onTestConnection: vi.fn(),
    onRefreshModels: vi.fn(),
    onNavigateToModels: vi.fn(),
    formatModelSize: (bytes: number) => `${bytes}B`,
  };

  it("handles endpoint input and detect action", async () => {
    const user = userEvent.setup();
    const onEndpointChange = vi.fn();
    const onDetectOllama = vi.fn();
    const onClearCredentialChange = vi.fn();

    render(
      <SettingsTab
        {...baseProps}
        onEndpointChange={onEndpointChange}
        onDetectOllama={onDetectOllama}
        onClearCredentialChange={onClearCredentialChange}
      />,
    );
    await user.type(
      screen.getByPlaceholderText("http://host.docker.internal:11434"),
      "http://localhost:11434",
    );
    await user.click(screen.getByLabelText("Clear stored credential on save"));
    await user.click(screen.getByRole("button", { name: /detect/i }));

    expect(onEndpointChange).toHaveBeenCalled();
    expect(onClearCredentialChange).toHaveBeenCalledWith(true);
    expect(onDetectOllama).toHaveBeenCalled();
  });

  it("renders model dropdown, refresh, status messages, and next-step hint actions", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    const onToggleModelDropdown = vi.fn();
    const onRefreshModels = vi.fn();
    const onNavigateToModels = vi.fn();
    const onSaveConfig = vi.fn();
    const onTestConnection = vi.fn();

    render(
      <SettingsTab
        {...baseProps}
        aiEndpoint="http://localhost:11434"
        aiModel=""
        detectMessage="Found endpoint"
        showModelDropdown={true}
        availableModels={[{ name: "llama3", size: 2048 } as any]}
        saveSuccess={true}
        saveError="Could not save"
        aiStatus="connected"
        aiStatusMessage="Connected"
        onSelectModel={onSelectModel}
        onToggleModelDropdown={onToggleModelDropdown}
        onRefreshModels={onRefreshModels}
        onNavigateToModels={onNavigateToModels}
        onSaveConfig={onSaveConfig}
        onTestConnection={onTestConnection}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show model list/i }));
    await user.click(screen.getByRole("button", { name: /llama3/i }));
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await user.click(
      screen.getByRole("button", { name: /save configuration/i }),
    );
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await user.click(screen.getByRole("button", { name: /^Models$/ }));

    expect(onToggleModelDropdown).toHaveBeenCalled();
    expect(onSelectModel).toHaveBeenCalledWith("llama3");
    expect(onRefreshModels).toHaveBeenCalled();
    expect(onSaveConfig).toHaveBeenCalled();
    expect(onTestConnection).not.toHaveBeenCalled();
    expect(onNavigateToModels).toHaveBeenCalled();
    expect(screen.getByText(/configuration saved/i)).toBeInTheDocument();
    expect(screen.getByText(/could not save/i)).toBeInTheDocument();
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("shows model-loading spinner when models are being fetched", () => {
    const { container } = render(
      <SettingsTab
        {...baseProps}
        aiEndpoint="http://localhost:11434"
        isLoadingModels={true}
      />,
    );

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows empty-models helper text when dropdown is open without installed models", () => {
    render(
      <SettingsTab
        {...baseProps}
        showModelDropdown={true}
        availableModels={[]}
      />,
    );

    expect(
      screen.getByText(
        "No detected models. Type the model identifier manually.",
      ),
    ).toBeInTheDocument();
  });

  it("renders direct model selection loading controls", () => {
    const { container } = render(
      <ModelSelectionControls
        providerType="ollama"
        aiEndpoint="http://localhost:11434"
        aiModel=""
        showModelDropdown={false}
        availableModels={[]}
        isLoadingModels={true}
        onModelChange={vi.fn()}
        onSelectModel={vi.fn()}
        onToggleModelDropdown={vi.fn()}
        onRefreshModels={vi.fn()}
        formatModelSize={(bytes) => `${bytes}B`}
      />,
    );

    expect(container.querySelectorAll(".animate-spin")).toHaveLength(2);
  });
});

describe("McpAccessTab", () => {
  const baseProps = {
    status: null,
    keys: [],
    users: [
      {
        id: "user-1",
        username: "alice",
        email: null,
        emailVerified: true,
        isAdmin: false,
        createdAt: "2026-04-26T00:00:00.000Z",
      },
    ],
    form: {
      userId: "",
      name: "",
      walletIds: "",
      allowAuditLogs: false,
      expiresAt: "",
    },
    loading: false,
    isCreating: false,
    revokingKeyId: null,
    createdToken: null,
    error: null,
    onFormChange: vi.fn(),
    onCreateKey: vi.fn(),
    onRevokeKey: vi.fn(),
    onDismissCreatedToken: vi.fn(),
    onRefresh: vi.fn(),
  };

  it("renders empty MCP state and disables invalid key creation", async () => {
    const user = userEvent.setup();
    const onFormChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <McpAccessTab
        {...baseProps}
        onFormChange={onFormChange}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText("No MCP keys.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create mcp key/i }),
    ).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Target User"), "user-1");
    await user.type(screen.getByLabelText("Key Name"), "LAN key");
    await user.type(screen.getByLabelText("Wallet Scope"), "wallet-1");
    await user.click(screen.getByLabelText("Allow audit log reads"));
    await user.click(
      screen.getByRole("button", { name: /refresh mcp access/i }),
    );

    expect(onFormChange).toHaveBeenCalledWith("userId", "user-1");
    expect(onFormChange).toHaveBeenCalledWith("name", expect.any(String));
    expect(onFormChange).toHaveBeenCalledWith("walletIds", expect.any(String));
    expect(onFormChange).toHaveBeenCalledWith("allowAuditLogs", true);
    expect(onRefresh).toHaveBeenCalled();
  });

  it("renders MCP status, token, lifecycle, scope, and action states", async () => {
    const user = userEvent.setup();
    const onCreateKey = vi.fn();
    const onRevokeKey = vi.fn();
    const onDismissCreatedToken = vi.fn();
    const now = new Date();
    const expiredAt = new Date(now.getTime() - 60_000).toISOString();

    render(
      <McpAccessTab
        {...baseProps}
        status={{
          enabled: false,
          host: "0.0.0.0",
          port: 7331,
          allowedHosts: ["192.168.1.0/24"],
          rateLimitPerMinute: 60,
          defaultPageSize: 50,
          maxPageSize: 250,
          maxDateRangeDays: 90,
          serverName: "sanctuary",
          serverVersion: "1.2.3",
        }}
        keys={[
          {
            id: "active-key",
            userId: "user-1",
            user: { id: "user-1", username: "alice", isAdmin: false },
            name: "Single wallet",
            keyPrefix: "mcp_active",
            scope: { walletIds: ["wallet-1"], allowAuditLogs: false },
            createdAt: "2026-04-26T00:00:00.000Z",
            lastUsedAt: "2026-04-26T01:00:00.000Z",
          },
          {
            id: "expired-key",
            userId: "user-2",
            name: "Two wallets",
            keyPrefix: "mcp_expired",
            scope: {
              walletIds: ["wallet-1", "wallet-2"],
              allowAuditLogs: true,
            },
            createdAt: "2026-04-26T00:00:00.000Z",
            expiresAt: expiredAt,
          },
          {
            id: "revoked-key",
            userId: "user-3",
            name: "All wallets",
            keyPrefix: "mcp_revoked",
            scope: {},
            createdAt: "2026-04-26T00:00:00.000Z",
            revokedAt: "2026-04-26T02:00:00.000Z",
          },
        ]}
        form={{
          userId: "user-1",
          name: "LAN key",
          walletIds: "",
          allowAuditLogs: false,
          expiresAt: "",
        }}
        loading={true}
        isCreating={true}
        revokingKeyId="expired-key"
        createdToken="mcp_created_token"
        error="Failed to load MCP access settings"
        onCreateKey={onCreateKey}
        onRevokeKey={onRevokeKey}
        onDismissCreatedToken={onDismissCreatedToken}
      />,
    );

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("0.0.0.0:7331")).toBeInTheDocument();
    expect(screen.getByText("sanctuary 1.2.3")).toBeInTheDocument();
    expect(screen.getByText("Rows 50-250")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to load MCP access settings"),
    ).toBeInTheDocument();
    expect(screen.getByText("mcp_created_token")).toBeInTheDocument();
    expect(screen.getByText("1 wallet")).toBeInTheDocument();
    expect(screen.getByText("2 wallets")).toBeInTheDocument();
    expect(screen.getByText("All accessible wallets")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByText("revoked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: /dismiss created mcp key/i }),
    );
    await user.click(screen.getAllByRole("button", { name: /revoke/i })[0]);

    expect(onDismissCreatedToken).toHaveBeenCalled();
    expect(onRevokeKey).toHaveBeenCalledWith("active-key");
    expect(
      screen.getAllByRole("button", { name: /revoke/i })[1],
    ).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: /revoke/i })[2],
    ).toBeDisabled();
  });
});

describe("ContainerControls", () => {
  it("shows start flow when stopped and stop flow when running", async () => {
    const user = userEvent.setup();
    const onStartContainer = vi.fn();
    const onStopContainer = vi.fn();
    const onRefreshContainerStatus = vi.fn();

    const { rerender } = render(
      <ContainerControls
        containerStatus={{ running: false } as any}
        isStartingContainer={false}
        onStartContainer={onStartContainer}
        onStopContainer={onStopContainer}
        onRefreshContainerStatus={onRefreshContainerStatus}
      />,
    );

    await user.click(screen.getByRole("button", { name: /start/i }));
    await user.click(screen.getByRole("button", { name: "" }));
    expect(onStartContainer).toHaveBeenCalled();
    expect(onRefreshContainerStatus).toHaveBeenCalled();

    rerender(
      <ContainerControls
        containerStatus={{ running: true } as any}
        isStartingContainer={false}
        onStartContainer={onStartContainer}
        onStopContainer={onStopContainer}
        onRefreshContainerStatus={onRefreshContainerStatus}
      />,
    );

    await user.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStopContainer).toHaveBeenCalled();
  });

  it("shows loader icon and disables actions while container start is in progress", async () => {
    const user = userEvent.setup();
    const onStartContainer = vi.fn();
    const onStopContainer = vi.fn();
    const onRefreshContainerStatus = vi.fn();

    render(
      <ContainerControls
        containerStatus={{ running: false } as any}
        isStartingContainer={true}
        onStartContainer={onStartContainer}
        onStopContainer={onStopContainer}
        onRefreshContainerStatus={onRefreshContainerStatus}
      />,
    );

    const startButton = screen.getByRole("button", { name: /start/i });
    expect(startButton).toBeDisabled();
    expect(startButton.querySelector(".animate-spin")).not.toBeNull();

    await user.click(startButton);
    expect(onStartContainer).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "" }));
    expect(onRefreshContainerStatus).toHaveBeenCalled();
    expect(onStopContainer).not.toHaveBeenCalled();
  });
});

describe("StatusTab", () => {
  const baseProps = {
    providerType: "ollama" as const,
    aiEnabled: false,
    isSaving: false,
    isStartingContainer: false,
    containerMessage: "",
    containerStatus: null,
    aiEndpoint: "",
    aiModel: "",
    onToggleAI: vi.fn(),
    onStartContainer: vi.fn(),
    onStopContainer: vi.fn(),
    onRefreshContainerStatus: vi.fn(),
    onNavigateToSettings: vi.fn(),
  };

  it("toggles AI and shows summary state", async () => {
    const user = userEvent.setup();
    const onToggleAI = vi.fn();
    render(<StatusTab {...baseProps} onToggleAI={onToggleAI} />);

    await user.click(screen.getByRole("button"));
    expect(onToggleAI).toHaveBeenCalled();
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });

  it("explains the external-provider data boundary", () => {
    render(<StatusTab {...baseProps} providerType="openai-compatible" />);

    expect(screen.getByText("AI Data Boundary")).toBeInTheDocument();
    expect(
      screen.getByText(/provider may run outside Sanctuary/i),
    ).toBeInTheDocument();
  });

  it("shows container controls and next-step action when enabled", async () => {
    const user = userEvent.setup();
    const onNavigateToSettings = vi.fn();
    const onStartContainer = vi.fn();
    const onStopContainer = vi.fn();
    const onRefreshContainerStatus = vi.fn();

    render(
      <StatusTab
        {...baseProps}
        aiEnabled={true}
        containerMessage="Starting..."
        containerStatus={
          { available: true, exists: true, running: false } as any
        }
        aiEndpoint="http://localhost:11434"
        aiModel="llama3"
        onNavigateToSettings={onNavigateToSettings}
        onStartContainer={onStartContainer}
        onStopContainer={onStopContainer}
        onRefreshContainerStatus={onRefreshContainerStatus}
      />,
    );

    expect(screen.getByText(/starting/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /start/i }));
    await user.click(screen.getByRole("button", { name: /settings/i }));

    expect(onStartContainer).toHaveBeenCalled();
    expect(onNavigateToSettings).toHaveBeenCalled();
  });

  it("renders loading spinner when container startup is in progress", () => {
    const { container } = render(
      <StatusTab
        {...baseProps}
        isStartingContainer={true}
        containerMessage="Booting container..."
      />,
    );

    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByText("Booting container...")).toBeInTheDocument();
  });
});
