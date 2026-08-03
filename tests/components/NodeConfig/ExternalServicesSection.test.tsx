import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExternalServicesSection } from "../../../src/components/NodeConfig/ExternalServicesSection";
import type { NodeConfig } from "../../../src/types";
import { DEFAULT_NODE_MEMPOOL_ESTIMATOR } from "@sanctuary/shared/constants/nodeConfig";

vi.mock("../../../src/components/PriceProviderDiagnostics", () => ({
  PriceProviderDiagnostics: () => (
    <div data-testid="price-provider-diagnostics">
      Price provider diagnostics
    </div>
  ),
}));

function createNodeConfig(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    type: "electrum",
    explorerUrl: "https://mempool.space",
    feeEstimatorUrl: "https://mempool.space",
    testnet3ExplorerUrl: "https://mempool.space/testnet",
    testnet3FeeEstimatorUrl: "https://mempool.space/testnet",
    testnet4ExplorerUrl: "https://mempool.space/testnet4",
    testnet4FeeEstimatorUrl: "https://mempool.space/testnet4",
    signetExplorerUrl: "https://mempool.space/signet",
    signetFeeEstimatorUrl: "https://mempool.space/signet",
    mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
    mainnetMode: "singleton",
    ...overrides,
  };
}

describe("ExternalServicesSection", () => {
  it("renders collapsed header state and toggles expansion", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onConfigChange = vi.fn();

    render(
      <ExternalServicesSection
        nodeConfig={createNodeConfig()}
        onConfigChange={onConfigChange}
        expanded={false}
        onToggle={onToggle}
        summary="Using mempool.space"
      />,
    );

    expect(screen.getByText("External Services")).toBeInTheDocument();
    expect(screen.getByText("Using mempool.space")).toBeInTheDocument();
    expect(screen.queryByLabelText("Block Explorer")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /external services/i }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it("updates explorer URL by input and preset buttons", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    const nodeConfig = createNodeConfig({
      explorerUrl: "https://mempool.space",
    });

    render(
      <ExternalServicesSection
        nodeConfig={nodeConfig}
        onConfigChange={onConfigChange}
        expanded
        onToggle={vi.fn()}
        summary="External config"
      />,
    );

    const [explorerInput] = screen.getAllByRole("textbox");
    fireEvent.change(explorerInput, {
      target: { value: "https://my-explorer.example" },
    });

    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...nodeConfig,
      explorerUrl: "https://my-explorer.example",
    });

    await user.click(screen.getByRole("button", { name: "mempool.space" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...nodeConfig,
      explorerUrl: "https://mempool.space",
    });

    await user.click(screen.getByRole("button", { name: "blockstream.info" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...nodeConfig,
      explorerUrl: "https://blockstream.info",
    });
  });

  it("updates network-specific explorer presets and fee source fields", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    const nodeConfig = createNodeConfig();

    const { rerender } = render(
      <ExternalServicesSection
        nodeConfig={nodeConfig}
        onConfigChange={onConfigChange}
        expanded
        onToggle={vi.fn()}
        summary="External config"
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Testnet3" }));
    await user.click(screen.getByRole("button", { name: "blockstream.info" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...nodeConfig,
      testnet3ExplorerUrl: "https://blockstream.info/testnet",
    });

    await user.click(screen.getByRole("tab", { name: "Testnet4" }));
    fireEvent.change(screen.getByLabelText("Testnet4 block explorer URL"), {
      target: { value: "https://explorer.testnet4.example" },
    });
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...nodeConfig,
      testnet4ExplorerUrl: "https://explorer.testnet4.example",
    });

    await user.click(screen.getByRole("radio", { name: "Electrum Server" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...nodeConfig,
      testnet4FeeEstimatorUrl: "",
    });

    rerender(
      <ExternalServicesSection
        nodeConfig={createNodeConfig({ testnet4FeeEstimatorUrl: "" })}
        onConfigChange={onConfigChange}
        expanded
        onToggle={vi.fn()}
        summary="External config"
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Testnet4" }));
    await user.click(screen.getByRole("radio", { name: "Mempool API" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...createNodeConfig({ testnet4FeeEstimatorUrl: "" }),
      testnet4FeeEstimatorUrl: "https://mempool.space/testnet4",
    });
  });

  it("uses an empty string input value when explorerUrl is unset", () => {
    render(
      <ExternalServicesSection
        nodeConfig={createNodeConfig({ explorerUrl: undefined })}
        onConfigChange={vi.fn()}
        expanded
        onToggle={vi.fn()}
        summary="External config"
      />,
    );

    const [explorerInput] = screen.getAllByRole("textbox");
    expect(explorerInput).toHaveValue("");
  });

  it("switches fee source and updates fee URL/estimator fields", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();

    const withElectrum = createNodeConfig({ feeEstimatorUrl: "" });
    const { rerender } = render(
      <ExternalServicesSection
        nodeConfig={withElectrum}
        onConfigChange={onConfigChange}
        expanded
        onToggle={vi.fn()}
        summary="Fee source test"
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Mempool API" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...withElectrum,
      feeEstimatorUrl: "https://mempool.space",
    });

    const withMempool = createNodeConfig({
      feeEstimatorUrl: "https://mempool.space/api",
    });
    rerender(
      <ExternalServicesSection
        nodeConfig={withMempool}
        onConfigChange={onConfigChange}
        expanded
        onToggle={vi.fn()}
        summary="Fee source test"
      />,
    );

    const mempoolUrlInput = screen.getByDisplayValue(
      "https://mempool.space/api",
    );
    fireEvent.change(mempoolUrlInput, {
      target: { value: "https://fees.example" },
    });
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...withMempool,
      feeEstimatorUrl: "https://fees.example",
    });

    await user.selectOptions(screen.getByRole("combobox"), "simple");
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...withMempool,
      mempoolEstimator: "simple",
    });

    await user.click(screen.getByRole("radio", { name: "Electrum Server" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({
      ...withMempool,
      feeEstimatorUrl: "",
    });
  });

  it("falls back estimator select value when mempoolEstimator is unset", () => {
    const nodeConfig = createNodeConfig({
      feeEstimatorUrl: "https://fees.custom",
      mempoolEstimator: undefined,
    });

    render(
      <ExternalServicesSection
        nodeConfig={nodeConfig}
        onConfigChange={vi.fn()}
        expanded
        onToggle={vi.fn()}
        summary="Fee source test"
      />,
    );

    expect(screen.getByRole("combobox")).toHaveValue(
      DEFAULT_NODE_MEMPOOL_ESTIMATOR,
    );
  });

  it("shows price provider diagnostics when expanded", () => {
    render(
      <ExternalServicesSection
        nodeConfig={createNodeConfig()}
        onConfigChange={vi.fn()}
        expanded
        onToggle={vi.fn()}
        summary="External config"
      />,
    );

    expect(
      screen.getByTestId("price-provider-diagnostics"),
    ).toBeInTheDocument();
  });
});
