import { describe, expect, it } from "vitest";
import { parseConsolePlanResponse } from "../../llm-egress-proxy/src/consoleProtocol";

const marketStatusTool = {
  name: "get_market_status",
  title: "Get Market Status",
  description: "Return cached BTC price and fee status",
  sensitivity: "public",
  requiredScope: "authenticated",
  inputFields: ["currencies", "includeFees"],
};

const feeEstimatesTool = {
  name: "get_fee_estimates",
  title: "Get Fee Estimates",
  description: "Return cached fee estimates",
  sensitivity: "public",
  requiredScope: "authenticated",
  inputFields: [],
};

const bitcoinNetworkStatusTool = {
  name: "get_bitcoin_network_status",
  title: "Get Bitcoin Network Status",
  description: "Return Bitcoin network status",
  sensitivity: "public",
  requiredScope: "authenticated",
  inputFields: [],
};

const convertPriceTool = {
  name: "convert_price",
  title: "Convert BTC Price",
  description: "Convert sats to fiat or fiat to sats",
  sensitivity: "public",
  requiredScope: "authenticated",
  inputFields: ["sats", "fiatAmount", "currency"],
};

const publicToolPlanInput = {
  prompt: "what is the BTC price?",
  scope: { kind: "general" },
  maxToolCalls: 4,
  tools: [
    marketStatusTool,
    feeEstimatesTool,
    bitcoinNetworkStatusTool,
    convertPriceTool,
  ],
};

describe("console planner public tool protocol", () => {
  it("resolves public market, fee, and network intents", () => {
    const result = parseConsolePlanResponse(
      JSON.stringify({
        intents: [
          { name: "get_market_status" },
          { name: "get_fee_estimates" },
          { name: "get_bitcoin_network_status" },
        ],
      }),
      4,
      publicToolPlanInput,
    );

    expect(result.toolCalls).toEqual([
      {
        name: "get_market_status",
        input: {},
        reason: "Resolved market status intent.",
      },
      {
        name: "get_fee_estimates",
        input: {},
        reason: "Resolved fee estimates intent.",
      },
      {
        name: "get_bitcoin_network_status",
        input: {},
        reason: "Resolved Bitcoin network status intent.",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("carries optional market status intent parameters only when present", () => {
    const withParams = parseConsolePlanResponse(
      JSON.stringify({
        intents: [
          {
            name: "get_market_status",
            currencies: ["USD", "EUR"],
            includeFees: false,
          },
        ],
      }),
      4,
      publicToolPlanInput,
    );
    const withoutParams = parseConsolePlanResponse(
      JSON.stringify({ intents: [{ name: "get_market_status" }] }),
      4,
      publicToolPlanInput,
    );

    expect(withParams.toolCalls).toEqual([
      {
        name: "get_market_status",
        input: { currencies: ["USD", "EUR"], includeFees: false },
        reason: "Resolved market status intent.",
      },
    ]);
    expect(withoutParams.toolCalls[0]?.input).toEqual({});
  });

  it("resolves valid price conversion intents and rejects invalid amounts", () => {
    const sats = parseConsolePlanResponse(
      JSON.stringify({
        intents: [{ name: "convert_price", sats: "100000", currency: "USD" }],
      }),
      4,
      publicToolPlanInput,
    );
    const fiat = parseConsolePlanResponse(
      JSON.stringify({
        intents: [{ name: "convert_price", fiatAmount: 12.5 }],
      }),
      4,
      publicToolPlanInput,
    );
    const both = parseConsolePlanResponse(
      JSON.stringify({
        intents: [{ name: "convert_price", sats: "1", fiatAmount: 1 }],
      }),
      4,
      publicToolPlanInput,
    );
    const neither = parseConsolePlanResponse(
      JSON.stringify({ intents: [{ name: "convert_price" }] }),
      4,
      publicToolPlanInput,
    );

    expect(sats.toolCalls).toEqual([
      {
        name: "convert_price",
        input: { sats: "100000", currency: "USD" },
        reason: "Resolved price conversion intent.",
      },
    ]);
    expect(fiat.toolCalls).toEqual([
      {
        name: "convert_price",
        input: { fiatAmount: 12.5 },
        reason: "Resolved price conversion intent.",
      },
    ]);
    expect(both).toEqual({
      toolCalls: [],
      warnings: ["model_response_invalid_intent"],
    });
    expect(neither).toEqual({
      toolCalls: [],
      warnings: ["model_response_invalid_intent"],
    });
  });

  it("does not plan unavailable public tools", () => {
    const result = parseConsolePlanResponse(
      JSON.stringify({
        intents: [
          { name: "get_market_status" },
          { name: "get_fee_estimates" },
          { name: "get_bitcoin_network_status" },
          { name: "convert_price", sats: 1 },
        ],
      }),
      4,
      {
        ...publicToolPlanInput,
        tools: [],
      },
    );

    expect(result).toEqual({
      toolCalls: [],
      warnings: ["model_response_unresolved_intent"],
    });
  });

  it("falls back to public tools for prose price, fee, and network prompts", () => {
    const price = parseConsolePlanResponse(
      "I should answer from current market data.",
      4,
      {
        ...publicToolPlanInput,
        prompt: "current btc price in usd",
      },
    );
    const fees = parseConsolePlanResponse(
      "I should answer from current fees.",
      4,
      {
        ...publicToolPlanInput,
        prompt: "what are current fees",
      },
    );
    const network = parseConsolePlanResponse(
      "I should answer from network status.",
      4,
      {
        ...publicToolPlanInput,
        prompt: "what's the block height",
      },
    );

    expect(price.toolCalls).toEqual([
      {
        name: "get_market_status",
        input: {},
        reason: "Fallback plan for market status request.",
      },
    ]);
    expect(fees.toolCalls).toEqual([
      {
        name: "get_fee_estimates",
        input: {},
        reason: "Fallback plan for fee estimate request.",
      },
    ]);
    expect(network.toolCalls).toEqual([
      {
        name: "get_bitcoin_network_status",
        input: {},
        reason: "Fallback plan for Bitcoin network status request.",
      },
    ]);
    expect(price.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
    expect(fees.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
    expect(network.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });
});
