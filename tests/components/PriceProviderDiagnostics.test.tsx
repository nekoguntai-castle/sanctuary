import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriceProviderDiagnostics } from "../../components/PriceProviderDiagnostics";
import * as priceApi from "../../src/api/price";

vi.mock("../../src/api/price", () => ({
  getProviderDiagnostics: vi.fn(),
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
