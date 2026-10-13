import { describe, expect, it } from "vitest";
import { fallbackPromptDateRange } from "../../llm-egress-proxy/src/consoleProtocolDates";

const input = (prompt: string) => ({ prompt, currentDate: "2026-04-28" }) as never;

describe("console fallback ISO date ranges", () => {
  it("does not throw on out-of-range months", () => {
    expect(fallbackPromptDateRange(input("transactions 2024-13-01 to 2024-13-05"))).toEqual({});
  });

  it("does not roll impossible calendar days into the next month", () => {
    expect(fallbackPromptDateRange(input("2024-02-30 to 2024-02-31"))).toEqual({});
  });

  it("rejects the range when only one end is invalid", () => {
    expect(fallbackPromptDateRange(input("2024-01-01 to 2024-02-31"))).toEqual({});
  });

  it("keeps valid ranges unchanged", () => {
    expect(fallbackPromptDateRange(input("2024-02-01 to 2024-02-29"))).toEqual({
      dateFrom: "2024-02-01T00:00:00.000Z",
      dateTo: "2024-02-29T23:59:59.999Z",
    });
  });

  it("does not remap years 0000-0099", () => {
    expect(fallbackPromptDateRange(input("0050-01-01 to 0050-01-02"))).toEqual({
      dateFrom: "0050-01-01T00:00:00.000Z",
      dateTo: "0050-01-02T23:59:59.999Z",
    });
  });
});
