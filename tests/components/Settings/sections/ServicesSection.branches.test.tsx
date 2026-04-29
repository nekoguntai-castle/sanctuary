import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesTab } from "../../../../components/Settings/sections/ServicesSection";

vi.mock("../../../../components/PriceProviderDiagnostics", () => ({
  PriceProviderDiagnostics: ({ currency }: { currency?: string }) => (
    <div data-testid="price-provider-diagnostics">{currency}</div>
  ),
}));

const state = vi.hoisted(() => ({
  priceProvider: "auto",
  btcPrice: null as number | null,
  isAdmin: true,
}));

const mockSetPriceProvider = vi.fn();
const mockRefreshPrice = vi.fn();

vi.mock("../../../../contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    priceProvider: state.priceProvider,
    setPriceProvider: mockSetPriceProvider,
    availableProviders: ["auto", "coingecko"],
    refreshPrice: mockRefreshPrice,
    priceLoading: false,
    lastPriceUpdate: null,
    btcPrice: state.btcPrice,
    currencySymbol: "$",
    fiatCurrency: "USD",
  }),
}));

vi.mock("../../../../contexts/UserContext", () => ({
  useUser: () => ({
    user: { isAdmin: state.isAdmin },
  }),
}));

describe("ServicesSection branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.priceProvider = "auto";
    state.btcPrice = null;
    state.isAdmin = true;
  });

  it("covers provider description and price display branches", () => {
    const { rerender } = render(<ServicesTab />);

    expect(
      screen.getByText(/aggregated prices from multiple sources/i),
    ).toBeInTheDocument();
    expect(screen.getByText("-----")).toBeInTheDocument();
    expect(screen.getByTestId("price-provider-diagnostics")).toHaveTextContent(
      "USD",
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "coingecko" },
    });
    expect(mockSetPriceProvider).toHaveBeenCalledWith("coingecko");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Price" }));
    expect(mockRefreshPrice).toHaveBeenCalledTimes(1);

    state.priceProvider = "coingecko";
    state.btcPrice = 98765;
    rerender(<ServicesTab />);

    expect(
      screen.getByText("Using coingecko as the exclusive price source."),
    ).toBeInTheDocument();
    expect(screen.getByText("$98,765")).toBeInTheDocument();
  });

  it("hides provider diagnostics for non-admin users", () => {
    state.isAdmin = false;

    render(<ServicesTab />);

    expect(
      screen.queryByTestId("price-provider-diagnostics"),
    ).not.toBeInTheDocument();
  });
});
