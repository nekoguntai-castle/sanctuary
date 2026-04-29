import { describe, expect, it, vi } from "vitest";

import { ApiError, apiClient, mockFetch } from "./clientTestHarness";

export const registerApiClientBasicContracts = () => {
  describe("ApiError", () => {
    it("should create an error with status and response", () => {
      const error = new ApiError("Not Found", 404, { detail: "missing" });
      expect(error.message).toBe("Not Found");
      expect(error.status).toBe(404);
      expect(error.response).toEqual({ detail: "missing" });
      expect(error.name).toBe("ApiError");
      expect(error).toBeInstanceOf(Error);
    });

    it("should work without response data", () => {
      const error = new ApiError("Server Error", 500);
      expect(error.status).toBe(500);
      expect(error.response).toBeUndefined();
    });
  });

  // ========================================
  // GET Requests
  // ========================================

  describe("GET Requests", () => {
    it("should make a successful GET request", async () => {
      const mockData = { users: [{ id: 1 }] };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData),
      });

      const result = await apiClient.get("/users");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockData);
    });

    it("should build query string from params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await apiClient.get("/users", { limit: 10, offset: 0, active: true });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=0");
      expect(calledUrl).toContain("active=true");
    });

    it("should skip undefined and null params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await apiClient.get("/users", {
        limit: 10,
        filter: undefined,
        sort: null,
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).not.toContain("filter");
      expect(calledUrl).not.toContain("sort");
    });

    it("should not append query string when params serialize to empty", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await apiClient.get("/users", { filter: undefined, sort: null });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toBe("/api/v1/users");
      expect(calledUrl).not.toContain("?");
    });

    // ADR 0001 / 0002 Phase 4: the Authorization header is no longer
    // set by the browser client. See the "Phase 4 — cookie auth + CSRF"
    // describe block at the end of this file for cookie-path assertions.
  });

  // ========================================
  // POST Requests
  // ========================================

  describe("POST Requests", () => {
    it("should send JSON body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1 }),
      });

      const body = { username: "test", password: "pass" };
      await apiClient.post("/auth/login", body);

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.method).toBe("POST");
      expect(calledOptions.body).toBe(JSON.stringify(body));
      expect(calledOptions.headers["Content-Type"]).toBe("application/json");
    });

    it("should handle POST without body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await apiClient.post("/action");

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.body).toBeUndefined();
    });

    it("should allow POST callers to override the request timeout", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await apiClient.post("/slow-action", {}, { timeoutMs: 120000 });

      expect(timeoutSpy).toHaveBeenCalledWith(120000);
      timeoutSpy.mockRestore();
    });
  });

  // ========================================
  // PUT / PATCH / DELETE
  // ========================================

  describe("PUT/PATCH/DELETE Requests", () => {
    it("should make PUT request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated: true }),
      });

      await apiClient.put("/resource/1", { name: "updated" });

      expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
    });

    it("should make PUT request without body when no data is provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated: true }),
      });

      await apiClient.put("/resource/1");

      expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it("should make PATCH request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ patched: true }),
      });

      await apiClient.patch("/resource/1", { field: "value" });

      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should make PATCH request without body when no data is provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ patched: true }),
      });

      await apiClient.patch("/resource/1");

      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it("should make DELETE request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ deleted: true }),
      });

      await apiClient.delete("/resource/1");

      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should handle DELETE with body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await apiClient.delete("/resource/batch", { ids: ["1", "2"] });

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.body).toBe(JSON.stringify({ ids: ["1", "2"] }));
    });
  });

  // ========================================
  // 204 No Content
  // ========================================

  describe("204 No Content", () => {
    it("should handle 204 response without parsing body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error("No body")),
      });

      const result = await apiClient.delete("/resource/1");
      expect(result).toEqual({});
    });
  });

  // ========================================
  // Error Handling
  // ========================================

  describe("Error Handling", () => {
    it("should throw ApiError for 4xx responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve({ message: "Validation failed" }),
      });

      await expect(apiClient.get("/bad-request")).rejects.toThrow(ApiError);
      try {
        await apiClient.get("/bad-request");
      } catch (error) {
        expect((error as InstanceType<typeof ApiError>).status).toBe(400);
        expect((error as InstanceType<typeof ApiError>).message).toBe(
          "Validation failed",
        );
      }
    });

    it("should throw ApiError for 401 Unauthorized", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.resolve({ message: "Invalid token" }),
      });

      await expect(apiClient.get("/protected")).rejects.toThrow(ApiError);
    });

    it("should throw ApiError for 404 Not Found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({ message: "Resource not found" }),
      });

      await expect(apiClient.get("/missing")).rejects.toThrow(
        "Resource not found",
      );
    });

    it("should use statusText as fallback message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: () => Promise.resolve({}),
      });

      try {
        await apiClient.get("/forbidden");
      } catch (error) {
        expect((error as InstanceType<typeof ApiError>).message).toContain(
          "403",
        );
      }
    });

    it("should extract message from nested error object when top-level message is absent", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "",
        json: () =>
          Promise.resolve({
            success: false,
            error: { type: "RateLimitError", message: "Too many requests" },
          }),
      });

      try {
        await apiClient.get("/rate-limited", undefined, { enabled: false });
      } catch (error) {
        expect((error as InstanceType<typeof ApiError>).message).toBe(
          "Too many requests",
        );
        expect((error as InstanceType<typeof ApiError>).status).toBe(429);
      }
    });

    it("should fall back to Unknown error when both message fields and statusText are empty", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "",
        json: () => Promise.resolve({}),
      });

      try {
        await apiClient.get("/empty-error", undefined, { enabled: false });
      } catch (error) {
        expect((error as InstanceType<typeof ApiError>).message).toBe(
          "HTTP 502: Unknown error",
        );
      }
    });

    it("should surface HTML proxy errors as ApiError instead of JSON parse failures", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 504,
        statusText: "Gateway Time-out",
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        text: () =>
          Promise.resolve("<html><title>504 Gateway Time-out</title></html>"),
      });

      try {
        await apiClient.post(
          "/console/prompts/prompt-1/replay",
          {},
          {
            retry: { enabled: false },
          },
        );
        throw new Error("expected request to fail");
      } catch (error) {
        const apiError = error as InstanceType<typeof ApiError>;
        expect(apiError).toBeInstanceOf(ApiError);
        expect(apiError.status).toBe(504);
        expect(apiError.message).toBe("HTTP 504: Gateway Time-out");
        expect(apiError.message).not.toContain("Unexpected token");
        expect(apiError.response).toMatchObject({
          bodyPreview: expect.stringContaining("504 Gateway Time-out"),
        });
      }
    });

    it("should parse text-backed JSON responses and reject invalid successful JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/plain" : null,
        },
        text: () => Promise.resolve('{"ok":true}'),
      });

      await expect(apiClient.get("/json-from-text")).resolves.toEqual({
        ok: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "application/json" : null,
        },
        text: () => Promise.resolve("{not valid json"),
      });

      await expect(apiClient.get("/bad-json")).rejects.toMatchObject({
        status: 200,
        message: "Invalid JSON response from API",
        response: expect.objectContaining({
          bodyPreview: "{not valid json",
        }),
      });
    });

    it("should preserve invalid error JSON as a body preview", async () => {
      const longInvalidJson = `{${"x".repeat(700)}`;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "application/json" : null,
        },
        text: () => Promise.resolve(longInvalidJson),
      });

      await expect(
        apiClient.get("/bad-error-json", undefined, { enabled: false }),
      ).rejects.toMatchObject({
        status: 502,
        message: "HTTP 502: Bad Gateway",
        response: expect.objectContaining({
          bodyPreview: expect.stringMatching(/^\{x+/),
        }),
      });
    });

    it("should handle empty text, text success, missing readers, and JSON reader failures", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve("   "),
      });
      await expect(apiClient.get("/empty-text")).resolves.toBeNull();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve("plain response"),
      });
      await expect(apiClient.get("/plain-text")).rejects.toMatchObject({
        status: 200,
        message: "HTTP 200: Expected JSON response from API",
        response: expect.objectContaining({
          bodyPreview: "plain response",
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      await expect(apiClient.get("/no-body-reader")).resolves.toBeNull();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("parse failed")),
      });
      await expect(apiClient.get("/json-reader-fails")).rejects.toMatchObject({
        status: 200,
        message: "Invalid JSON response from API",
      });
    });

    it("should parse text JSON when the response has no headers reader", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"ok":true}'),
      });

      await expect(apiClient.get("/json-without-headers")).resolves.toEqual({
        ok: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {},
        text: () => Promise.resolve('{"ok":true}'),
      });

      await expect(
        apiClient.get("/json-without-header-getter"),
      ).resolves.toEqual({
        ok: true,
      });
    });

    it("should parse text JSON when response headers have no get method", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {},
        text: () => Promise.resolve('{"ok":true}'),
      });

      await expect(apiClient.get("/json-with-header-object")).resolves.toEqual({
        ok: true,
      });
    });

    it("should preserve primitive and string error bodies", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve("plain error"),
      });

      await expect(
        apiClient.get("/string-error", undefined, { enabled: false }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          bodyPreview: "plain error",
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 418,
        statusText: "Teapot",
        json: () => Promise.resolve(false),
      });

      await expect(
        apiClient.get("/boolean-error", undefined, { enabled: false }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          body: false,
        }),
      });
    });

    it("should fall back when nested error messages are blank", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: () => Promise.resolve({ error: { message: "   " } }),
      });

      await expect(
        apiClient.get("/blank-nested-error", undefined, { enabled: false }),
      ).rejects.toThrow("HTTP 429: Too Many Requests");
    });

    it("should omit empty body previews from whitespace string error bodies", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: () => Promise.resolve("   "),
      });

      await expect(
        apiClient.get("/blank-string-error", undefined, { enabled: false }),
      ).rejects.toMatchObject({
        status: 500,
        response: { message: "HTTP 500: Server Error" },
      });
    });

    it("should extract string error responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve({ error: "explicit error string" }),
      });

      await expect(
        apiClient.get("/string-error-field", undefined, { enabled: false }),
      ).rejects.toThrow("explicit error string");
    });
  });

  // ========================================
  // Retry Behavior
  // ========================================
};
