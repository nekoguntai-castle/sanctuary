import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKEND_FETCH_TIMEOUT_MS,
  fetchFromBackend,
} from "../../llm-egress-proxy/src/utils";

const fetchMock = vi.fn();

describe("LLM egress proxy backend utilities", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses a bounded backend fetch with bearer auth", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ walletId: "wallet-1" }),
    });

    await expect(
      fetchFromBackend<{ walletId: string }>(
        "http://backend:3001",
        "/internal/ai/tx/tx-1",
        "service-token",
        "transaction context",
      ),
    ).resolves.toEqual({
      success: true,
      data: { walletId: "wallet-1" },
    });

    expect(timeoutSpy).toHaveBeenCalledWith(BACKEND_FETCH_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:3001/internal/ai/tx/tx-1",
      {
        headers: { Authorization: "Bearer service-token" },
        signal: timeoutSignal,
      },
    );
  });

  it("maps aborted backend fetches to network errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("The operation was aborted"));

    await expect(
      fetchFromBackend(
        "http://backend:3001",
        "/internal/ai/tx/tx-1",
        "service-token",
        "transaction context",
      ),
    ).resolves.toEqual({ success: false, error: "network_error" });
  });
});
