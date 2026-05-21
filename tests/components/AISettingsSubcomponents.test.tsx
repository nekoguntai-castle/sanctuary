import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
    expect(screen.getAllByText(/host ollama/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/openai-compatible server/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/bundled ollama/i)).not.toBeInTheDocument();
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
    availableModels: [] as any[],
    isLoadingModels: false,
    onModelChange: vi.fn(),
    onSelectModel: vi.fn(),
    onRefreshModels: vi.fn(),
    formatBytes: (bytes: number) => `${bytes}B`,
  };

  it("lets operators enter a model identifier manually", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(
      <ModelsTab
        {...baseProps}
        aiModel="saved-model"
        onModelChange={onModelChange}
      />,
    );

    await user.type(screen.getByLabelText(/selected model/i), "-v2");

    expect(onModelChange).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^pull$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("renders detected models without pull or delete actions", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    render(
      <ModelsTab
        {...baseProps}
        providerType="openai-compatible"
        aiModel="lmstudio/model-a"
        availableModels={[
          { name: "lmstudio/model-a", size: 0 } as any,
          { name: "lmstudio/model-b", size: 10 } as any,
        ]}
        onSelectModel={onSelectModel}
      />,
    );

    expect(screen.getByText("Detected Provider Models")).toBeInTheDocument();
    expect(screen.getByText("lmstudio/model-a")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^pull$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use" }));
    expect(onSelectModel).toHaveBeenCalledWith("lmstudio/model-b");

    await user.click(screen.getByRole("button", { name: /selected/i }));
    expect(onSelectModel).toHaveBeenCalledTimes(1);
  });

  it("renders detected-model loading state with a spinning refresh action", () => {
    const { container } = render(
      <ModelsTab {...baseProps} isLoadingModels={true} />,
    );

    expect(screen.getByText(/loading provider models/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /refresh/i })[0],
    ).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
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

    const { rerender } = render(
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

    rerender(
      <SettingsTab
        {...baseProps}
        aiStatus="idle"
        aiStatusMessage="Waiting for configuration"
      />,
    );
    expect(screen.getByText(/waiting for configuration/i)).toBeInTheDocument();
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

  it("shows empty-models helper text when dropdown is open without detected models", () => {
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

  it("renders blocked endpoint detection messages as visible errors", () => {
    render(
      <SettingsTab
        {...baseProps}
        detectMessage="AI endpoint is blocked: host_not_allowed. Use host.docker.internal for providers on the Docker host, or set LLM_EGRESS_PROXY_ALLOWED_CIDRS to include numeric LAN IP endpoints."
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("host_not_allowed");
    expect(alert).toHaveTextContent("LLM_EGRESS_PROXY_ALLOWED_CIDRS");
    expect(alert.className).toContain("text-rose");
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

describe("StatusTab", () => {
  const baseProps = {
    providerType: "ollama" as const,
    aiEnabled: false,
    isSaving: false,
    aiEndpoint: "",
    aiModel: "",
    onToggleAI: vi.fn(),
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

  it("shows next-step action when enabled", async () => {
    const user = userEvent.setup();
    const onNavigateToSettings = vi.fn();

    render(
      <StatusTab
        {...baseProps}
        aiEnabled={true}
        aiEndpoint="http://localhost:11434"
        aiModel="llama3"
        onNavigateToSettings={onNavigateToSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: /settings/i }));

    expect(onNavigateToSettings).toHaveBeenCalled();
    expect(screen.queryByText(/local ai container/i)).not.toBeInTheDocument();
  });
});
