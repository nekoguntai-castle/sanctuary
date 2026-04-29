import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriceProviderDiagnostics } from "../../components/PriceProviderDiagnostics";
import * as priceApi from "../../src/api/price";

vi.mock("../../src/api/price", () => ({
  PRICE_PROVIDERS_CHANGED_EVENT: "sanctuary:price-providers-changed",
  getProviderDiagnostics: vi.fn(),
  setPriceProviderEnabled: vi.fn(),
  testPriceProvider: vi.fn(),
  testAllPriceProviders: vi.fn(),
}));

const providers = [
  {
    name: "mempool",
    priority: 100,
    supportedCurrencies: ["USD", "EUR"],
    enabled: true,
  },
  {
    name: "binance",
    priority: 60,
    supportedCurrencies: ["USD"],
    enabled: false,
  },
];

describe("PriceProviderDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(priceApi.getProviderDiagnostics).mockResolvedValue({
      providers,
      count: providers.length,
    });
  });

  it("loads provider metadata and shows enabled state", async () => {
    render(<PriceProviderDiagnostics currency="usd" />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
      expect(screen.getByText("Binance")).toBeInTheDocument();
    });

    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("toggles provider enablement and notifies provider consumers", async () => {
    const nextProviders = providers.map((provider) =>
      provider.name === "binance" ? { ...provider, enabled: true } : provider,
    );
    vi.mocked(priceApi.setPriceProviderEnabled).mockResolvedValue({
      provider: "binance",
      enabled: true,
      providers: nextProviders,
      count: nextProviders.length,
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(screen.getByText("Binance")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Enable binance price provider",
      }),
    );

    await waitFor(() => {
      expect(priceApi.setPriceProviderEnabled).toHaveBeenCalledWith(
        "binance",
        true,
      );
      expect(
        screen.getByRole("switch", {
          name: "Disable binance price provider",
        }),
      ).toBeChecked();
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: priceApi.PRICE_PROVIDERS_CHANGED_EVENT,
        }),
      );
    });

    dispatchSpy.mockRestore();
  });

  it("surfaces provider enablement failures", async () => {
    vi.mocked(priceApi.setPriceProviderEnabled).mockRejectedValue(
      new Error("At least one price provider must remain enabled"),
    );

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Disable mempool price provider",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("At least one price provider must remain enabled"),
      ).toBeInTheDocument();
    });
  });

  it("tests one provider and displays the result", async () => {
    vi.mocked(priceApi.testPriceProvider).mockResolvedValue({
      provider: "mempool",
      enabled: true,
      ok: true,
      currency: "USD",
      latencyMs: 25,
      price: 50000,
      timestamp: "2026-04-29T00:00:00.000Z",
    });

    render(<PriceProviderDiagnostics currency="usd" />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Test mempool price provider" }),
    );

    await waitFor(() => {
      expect(priceApi.testPriceProvider).toHaveBeenCalledWith("mempool", "USD");
      expect(screen.getByText("Works in 25ms")).toBeInTheDocument();
      expect(screen.getByText("USD 50,000")).toBeInTheDocument();
    });
  });

  it("tests all providers and displays failures", async () => {
    vi.mocked(priceApi.testAllPriceProviders).mockResolvedValue({
      currency: "USD",
      providers: [
        {
          provider: "mempool",
          enabled: true,
          ok: true,
          currency: "USD",
          latencyMs: 20,
          price: 50000,
        },
        {
          provider: "binance",
          enabled: false,
          ok: false,
          currency: "USD",
          latencyMs: 40,
          error: "HTTP 451",
        },
      ],
    });

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Test All" }));

    await waitFor(() => {
      expect(priceApi.testAllPriceProviders).toHaveBeenCalledWith("USD");
      expect(screen.getByText("HTTP 451")).toBeInTheDocument();
    });
  });

  it("handles provider results without latency, price, or error details", async () => {
    vi.mocked(priceApi.testAllPriceProviders).mockResolvedValue({
      currency: "USD",
      providers: [
        {
          provider: "mempool",
          enabled: true,
          ok: true,
          currency: "USD",
          latencyMs: -1,
        },
        {
          provider: "binance",
          enabled: false,
          ok: false,
          currency: "USD",
          latencyMs: 0,
        },
      ],
    });

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Test All" }));

    await waitFor(() => {
      expect(screen.getByText("Works")).toBeInTheDocument();
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
    });
  });

  it("records a failed individual provider test", async () => {
    vi.mocked(priceApi.testPriceProvider).mockRejectedValue(
      new Error("provider timeout"),
    );

    render(<PriceProviderDiagnostics currency="eur" />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Test mempool price provider" }),
    );

    await waitFor(() => {
      expect(priceApi.testPriceProvider).toHaveBeenCalledWith("mempool", "EUR");
      expect(screen.getByText("provider timeout")).toBeInTheDocument();
    });
  });

  it("records a non-error failed individual provider test", async () => {
    vi.mocked(priceApi.testPriceProvider).mockRejectedValue("timeout");

    render(<PriceProviderDiagnostics currency="eur" />);

    await waitFor(() => {
      expect(screen.getByText("Binance")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Test binance price provider" }),
    );

    await waitFor(() => {
      expect(priceApi.testPriceProvider).toHaveBeenCalledWith("binance", "EUR");
      expect(screen.getByText("Test request failed")).toBeInTheDocument();
    });
  });

  it("ignores successful initial metadata loading after unmount", async () => {
    let resolveProviders!: (
      value: Awaited<ReturnType<typeof priceApi.getProviderDiagnostics>>,
    ) => void;
    vi.mocked(priceApi.getProviderDiagnostics).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProviders = resolve;
        }),
    );

    const view = render(<PriceProviderDiagnostics />);
    view.unmount();

    await act(async () => {
      resolveProviders({ providers, count: providers.length });
      await Promise.resolve();
    });
  });

  it("ignores failed initial metadata loading after unmount", async () => {
    let rejectProviders!: (error: Error) => void;
    vi.mocked(priceApi.getProviderDiagnostics).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectProviders = reject;
        }),
    );

    const view = render(<PriceProviderDiagnostics />);
    view.unmount();

    await act(async () => {
      rejectProviders(new Error("offline"));
      await Promise.resolve();
    });
  });

  it("surfaces refresh failures after metadata was loaded", async () => {
    vi.mocked(priceApi.getProviderDiagnostics)
      .mockResolvedValueOnce({
        providers,
        count: providers.length,
      })
      .mockRejectedValueOnce(new Error("offline"));

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(
        screen.getByText("Unable to load price provider diagnostics."),
      ).toBeInTheDocument();
    });
  });

  it("refreshes provider metadata successfully", async () => {
    vi.mocked(priceApi.getProviderDiagnostics)
      .mockResolvedValueOnce({
        providers,
        count: providers.length,
      })
      .mockResolvedValueOnce({
        providers: [providers[1]],
        count: 1,
      });

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.queryByText("Mempool")).not.toBeInTheDocument();
      expect(screen.getByText("Binance")).toBeInTheDocument();
    });
  });

  it("surfaces test-all request failures", async () => {
    vi.mocked(priceApi.testAllPriceProviders).mockRejectedValue(
      new Error("all providers unavailable"),
    );

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(screen.getByText("Mempool")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Test All" }));

    await waitFor(() => {
      expect(screen.getByText("all providers unavailable")).toBeInTheDocument();
    });
  });

  it("shows a load error when provider metadata fails", async () => {
    vi.mocked(priceApi.getProviderDiagnostics).mockRejectedValue(
      new Error("offline"),
    );

    render(<PriceProviderDiagnostics />);

    await waitFor(() => {
      expect(
        screen.getByText("Unable to load price provider diagnostics."),
      ).toBeInTheDocument();
    });
  });
});
