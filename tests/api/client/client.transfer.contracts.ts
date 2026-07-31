import { describe, expect, it, vi } from "vitest";

import {
  apiClient,
  mockDownloadBlob,
  mockFetch,
  mockRefreshAccessToken,
} from "./clientTestHarness";

function okJsonResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

function okBlobResponse(blob: Blob, headers?: Record<string, string>) {
  const headersMap = new Map<string, string>(Object.entries(headers ?? {}));
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headersMap.get(name) ?? null },
    blob: () => Promise.resolve(blob),
  };
}

function errorResponse(
  status: number,
  body: unknown = { message: "Unauthorized" },
) {
  return {
    ok: false,
    status,
    statusText: status === 401 ? "Unauthorized" : "Error",
    json: () => Promise.resolve(body),
  };
}

export const registerApiClientTransferContracts = () => {
  describe("Upload", () => {
    it("should send FormData without Content-Type header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ uploaded: true }),
      });

      const formData = new FormData();
      formData.append("file", new Blob(["test"]), "test.txt");

      await apiClient.upload("/upload", formData);

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.method).toBe("POST");
      expect(calledOptions.body).toBe(formData);
      // Should NOT set Content-Type (browser sets it with boundary)
      expect(calledOptions.headers["Content-Type"]).toBeUndefined();
      // Browser callers authenticate via HttpOnly cookies, so transfer
      // helpers send credentials: 'include' instead of a Bearer header.
      expect(calledOptions.credentials).toBe("include");
    });

    it("should throw ApiError for failed upload responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({}),
      });

      const formData = new FormData();
      formData.append("file", new Blob(["test"]), "test.txt");

      await expect(
        apiClient.upload("/upload", formData),
      ).rejects.toMatchObject({
        status: 500,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should send an upload only once after an ambiguous network failure", async () => {
      mockFetch.mockRejectedValue(new TypeError("connection closed after commit"));
      const formData = new FormData();
      formData.append("file", new Blob(["test"]), "test.txt");

      await expect(
        apiClient.upload("/upload", formData),
      ).rejects.toMatchObject({
        status: 0,
        message: "connection closed after commit",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should refresh and retry uploads once after a 401", async () => {
      const formData = new FormData();
      formData.append("file", new Blob(["test"]), "test.txt");
      mockFetch
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(okJsonResponse({ uploaded: true }));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      const result = await apiClient.upload<{ uploaded: boolean }>(
        "/upload",
        formData,
      );

      expect(result).toEqual({ uploaded: true });
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][1].body).toBe(formData);
      expect(mockFetch.mock.calls[1][1].body).toBe(formData);
      expect(mockFetch.mock.calls[1][1].headers["Content-Type"]).toBeUndefined();
    });

    it("should re-read CSRF before replaying an upload after refresh", async () => {
      document.cookie = "sanctuary_csrf=old-csrf; path=/";
      const formData = new FormData();
      formData.append("file", new Blob(["test"]), "test.txt");
      mockFetch
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(okJsonResponse({ uploaded: true }));
      mockRefreshAccessToken.mockImplementationOnce(() => {
        document.cookie = "sanctuary_csrf=new-csrf; path=/";
        return Promise.resolve();
      });

      await apiClient.upload("/upload", formData);

      expect(mockFetch.mock.calls[0][1].headers["X-CSRF-Token"]).toBe(
        "old-csrf",
      );
      expect(mockFetch.mock.calls[1][1].headers["X-CSRF-Token"]).toBe(
        "new-csrf",
      );
    });

    it("should reject non-FormData upload bodies before fetching", async () => {
      await expect(
        apiClient.upload(
          "/upload",
          { stream: true } as unknown as FormData,
        ),
      ).rejects.toMatchObject({
        status: 0,
        message: "Upload body must be FormData to support auth refresh retry",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Blob / Download
  // ========================================

  describe("Blob / Download", () => {
    it("should retry default GET blob transport failures", async () => {
      const blob = new Blob(["retried-bytes"]);
      const controller = new AbortController();
      mockFetch
        .mockRejectedValueOnce(new TypeError("temporary network failure"))
        .mockResolvedValueOnce(okBlobResponse(blob));

      await expect(
        apiClient.fetchBlob("/exports/archive", {
          signal: controller.signal,
        }),
      ).resolves.toBe(blob);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry custom POST blob transport failures", async () => {
      mockFetch.mockRejectedValue(new TypeError("ambiguous completion"));

      await expect(
        apiClient.fetchBlob("/exports/archive", { method: "POST" }),
      ).rejects.toMatchObject({
        status: 0,
        message: "ambiguous completion",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should reject an already-aborted blob request before fetching", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        apiClient.fetchBlob("/exports/archive", {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({
        name: "AbortError",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should abort during GET blob backoff without another fetch", async () => {
      const controller = new AbortController();
      vi.spyOn(controller.signal, "reason", "get").mockReturnValue(undefined);
      const firstAttempt = Promise.reject(
        new TypeError("temporary network failure"),
      );
      const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
      mockFetch.mockReturnValueOnce(firstAttempt);

      const request = apiClient.fetchBlob("/exports/archive", {
        signal: controller.signal,
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(timeoutSpy).toHaveBeenCalled();
      controller.abort();

      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should fetch blob with params, method, and credentials:include", async () => {
      const blob = new Blob(["file-bytes"], {
        type: "application/octet-stream",
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
      });

      const result = await apiClient.fetchBlob("/exports/archive", {
        method: "POST",
        params: { from: "2026-01-01", to: "2026-01-31" },
      });

      expect(result).toBe(blob);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("/exports/archive?");
      expect(mockFetch.mock.calls[0][0]).toContain("from=2026-01-01");
      expect(mockFetch.mock.calls[0][0]).toContain("to=2026-01-31");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      // Browser auth is via HttpOnly cookies, not a Bearer header.
      expect(mockFetch.mock.calls[0][1].credentials).toBe("include");
    });

    it("should append blob params to endpoints that already include a query string", async () => {
      const blob = new Blob(["file-bytes"]);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
      });

      await apiClient.fetchBlob("/exports/archive?format=csv", {
        params: { from: "2026-01-01" },
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "/api/v1/exports/archive?format=csv&from=2026-01-01",
      );
    });

    it("should normalize Headers instances on blob requests", async () => {
      const blob = new Blob(["file-bytes"]);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
      });

      await apiClient.fetchBlob("/exports/archive", {
        headers: new Headers([["X-Trace-Id", "trace-headers"]]),
      });

      expect(mockFetch.mock.calls[0][1].headers["x-trace-id"]).toBe(
        "trace-headers",
      );
    });

    it("should normalize tuple-array headers on blob requests", async () => {
      const blob = new Blob(["file-bytes"]);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
      });

      await apiClient.fetchBlob("/exports/archive", {
        headers: [["X-Trace-Id", "trace-array"]],
      });

      expect(mockFetch.mock.calls[0][1].headers["X-Trace-Id"]).toBe(
        "trace-array",
      );
    });

    it("should allow replayable blob request bodies", async () => {
      const blob = new Blob(["file-bytes"]);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
      });

      await expect(
        apiClient.fetchBlob("/exports/archive", {
          method: "POST",
          body: "payload",
        }),
      ).resolves.toBe(blob);

      expect(mockFetch.mock.calls[0][1].body).toBe("payload");
    });

    it("should refresh and retry fetchBlob once after a 401", async () => {
      const blob = new Blob(["retried-bytes"], {
        type: "application/octet-stream",
      });
      mockFetch
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(okBlobResponse(blob));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      const result = await apiClient.fetchBlob("/exports/archive", {
        method: "POST",
        params: { from: "2026-01-01" },
      });

      expect(result).toBe(blob);
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(mockFetch.mock.calls[1][0]);
      expect(mockFetch.mock.calls[1][1].method).toBe("POST");
    });

    it("should surface the original fetchBlob 401 when refresh fails", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401));
      mockRefreshAccessToken.mockRejectedValueOnce(new Error("refresh failed"));

      await expect(
        apiClient.fetchBlob("/exports/archive", { method: "POST" }),
      ).rejects.toMatchObject({
        status: 401,
        message: "Unauthorized",
      });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should not refresh fetchBlob again when the replay also returns 401", async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(errorResponse(401, { message: "Still unauthorized" }));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      await expect(
        apiClient.fetchBlob("/exports/archive", { method: "POST" }),
      ).rejects.toMatchObject({
        status: 401,
        message: "Still unauthorized",
      });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should reject non-replayable blob request bodies before fetching", async () => {
      const requestBody = new Request("https://example.test/upload", {
        method: "POST",
        body: "payload",
      }) as unknown as BodyInit;

      await expect(
        apiClient.fetchBlob("/exports/archive", {
          method: "POST",
          body: requestBody,
        }),
      ).rejects.toMatchObject({
        status: 0,
        message: "Blob request body is not replayable after an auth refresh",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it("should reject readable stream blob request bodies before fetching", async () => {
      const requestBody = new ReadableStream() as unknown as BodyInit;

      await expect(
        apiClient.fetchBlob("/exports/archive", {
          method: "POST",
          body: requestBody,
        }),
      ).rejects.toMatchObject({
        status: 0,
        message: "Blob request body is not replayable after an auth refresh",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it("should reject response blob request bodies before fetching", async () => {
      const requestBody = new Response("payload") as unknown as BodyInit;

      await expect(
        apiClient.fetchBlob("/exports/archive", {
          method: "POST",
          body: requestBody,
        }),
      ).rejects.toMatchObject({
        status: 0,
        message: "Blob request body is not replayable after an auth refresh",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it("should throw ApiError with HTTP fallback when fetchBlob error body is not JSON", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: () => Promise.reject(new Error("not-json")),
      });

      await expect(
        apiClient.fetchBlob("/exports/archive", { method: "POST" }),
      ).rejects.toMatchObject({
        status: 502,
        message: "HTTP 502: Bad Gateway",
      });
    });

    it("should use status fallback when fetchBlob error JSON has no message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({}),
      });

      await expect(
        apiClient.fetchBlob("/exports/archive", { method: "POST" }),
      ).rejects.toMatchObject({
        status: 500,
        message: "HTTP 500: Internal Server Error",
      });
    });

    it("should resolve filename from Content-Disposition when downloading", async () => {
      const blob = new Blob(["backup-bytes"], { type: "application/gzip" });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) =>
            header === "Content-Disposition"
              ? 'attachment; filename=\"backup-2026.tar.gz\"'
              : null,
        },
        blob: () => Promise.resolve(blob),
      });

      await apiClient.download("/admin/backup", "fallback.tar.gz", {
        params: { walletId: "w1" },
      });

      expect(mockFetch.mock.calls[0][0]).toContain("/admin/backup?walletId=w1");
      // Cookie-based auth uses credentials:'include'.
      expect(mockFetch.mock.calls[0][1].credentials).toBe("include");
      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, "backup-2026.tar.gz");
    });

    it("should retry default GET download transport failures", async () => {
      const blob = new Blob(["retried-download"]);
      mockFetch
        .mockRejectedValueOnce(new TypeError("temporary network failure"))
        .mockResolvedValueOnce(okBlobResponse(blob));

      await apiClient.download("/admin/backup", "backup.tar.gz");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, "backup.tar.gz");
    });

    it("should not retry custom POST download transport failures", async () => {
      mockFetch.mockRejectedValue(new TypeError("ambiguous completion"));

      await expect(
        apiClient.download("/admin/backup", "backup.tar.gz", {
          method: "POST",
        }),
      ).rejects.toMatchObject({
        status: 0,
        message: "ambiguous completion",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry after a local download side effect throws", async () => {
      const blob = new Blob(["downloaded-once"]);
      mockFetch.mockResolvedValue(okBlobResponse(blob));
      mockDownloadBlob.mockImplementationOnce(() => {
        throw new Error("local download cleanup failed");
      });

      await expect(
        apiClient.download("/admin/backup", "backup.tar.gz"),
      ).rejects.toThrow("local download cleanup failed");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockDownloadBlob).toHaveBeenCalledTimes(1);
    });

    it("should refresh and retry downloads once while preserving retry filename", async () => {
      const blob = new Blob(["backup-bytes"], { type: "application/gzip" });
      mockFetch
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(
          okBlobResponse(blob, {
            "Content-Disposition": 'attachment; filename="backup-after-refresh.tar.gz"',
          }),
        );
      mockRefreshAccessToken.mockResolvedValue(undefined);

      await apiClient.download("/admin/backup", "fallback.tar.gz", {
        method: "POST",
      });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockDownloadBlob).toHaveBeenCalledTimes(1);
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        blob,
        "backup-after-refresh.tar.gz",
      );
    });

    it("should use default download filename when none is provided", async () => {
      const blob = new Blob(["raw-bytes"]);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: () => Promise.resolve(blob),
      });

      await apiClient.download("/reports/daily");

      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, "download");
    });

    it("should keep provided filename when content disposition has no filename", async () => {
      const blob = new Blob(["raw-bytes"]);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) =>
            header === "Content-Disposition" ? "attachment" : null,
        },
        blob: () => Promise.resolve(blob),
      });

      await apiClient.download("/reports/daily", "fallback.csv");

      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, "fallback.csv");
    });

    it("should throw ApiError on download failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({ message: "File not found" }),
      });

      await expect(
        apiClient.download("/admin/backup/missing", undefined, {
          method: "POST",
        }),
      ).rejects.toMatchObject({
        status: 404,
        message: "File not found",
      });
    });

    it("should throw HTTP fallback when download error body is not JSON", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: () => Promise.reject(new Error("not-json")),
      });

      await expect(
        apiClient.download("/admin/backup/missing", undefined, {
          method: "POST",
        }),
      ).rejects.toMatchObject({
        status: 503,
        message: "HTTP 503: Service Unavailable",
      });
    });

    it("should use status fallback when download error JSON has no message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve({}),
      });

      await expect(
        apiClient.download("/admin/backup/missing"),
      ).rejects.toMatchObject({
        status: 400,
        message: "HTTP 400: Bad Request",
      });
    });
  });
};
