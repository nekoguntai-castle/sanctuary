import { describe, expect, it } from "vitest";
import { createTorContainer, mockFetch } from "./dockerTestHarness";

export function registerDockerTorCreateContracts(): void {
  describe("createTorContainer", () => {
    it("should return success if already running", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: "tor123",
            Names: ["/sanctuary-tor"],
            State: "running",
          },
        ],
      });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      expect(result.message).toContain("already running");
    });

    it("should start existing tor container when it exists but is stopped", async () => {
      // Initial status check (exists but not running)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: "tor-existing",
            Names: ["/sanctuary-tor"],
            State: "exited",
          },
        ],
      });
      // startTor() internal status check (exists but not running)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: "tor-existing",
            Names: ["/sanctuary-tor"],
            State: "exited",
          },
        ],
      });
      // start call
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      expect(result.message).toContain("started successfully");
    });

    it("should create new container", async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "Done",
      });

      // List containers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: "newtor123" }),
      });

      // Start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      expect(result.message).toContain("created and started");
      const pullCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("/images/create"),
      );
      const createCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("/containers/create"),
      );
      if (!pullCall || !createCall)
        throw new Error("Tor image pull/create requests were not issued");
      const pullUrl = new URL(pullCall[0] as string);
      expect(pullUrl.searchParams.get("fromImage")).toBe("dperson/torproxy");
      expect(pullUrl.searchParams.get("tag")).toBe(
        "sha256:d8b5f1cf24f1b7a0aa334929a264b2606a107223dd0d51eb1cda8aae6fbeec53",
      );
      expect(pullCall[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(createCall[1]?.body))).toMatchObject({
        Image:
          "dperson/torproxy@sha256:d8b5f1cf24f1b7a0aa334929a264b2606a107223dd0d51eb1cda8aae6fbeec53",
      });
    });

    it("fails when Docker reports a pull error inside an HTTP-200 stream", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('{"status":"pulling"}\n'),
          );
          controller.enqueue(
            new TextEncoder().encode(
              '{"errorDetail":{"message":"digest unavailable"}}\n',
            ),
          );
          controller.close();
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body });

      const result = await createTorContainer();

      expect(result).toEqual({
        success: false,
        message: "Failed to pull Tor image: digest unavailable",
      });
    });

    it("uses the top-level error when error details omit a message", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              '{"errorDetail":{},"error":"fallback pull error"}\n',
            ),
          );
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body });

      const result = await createTorContainer();

      expect(result.message).toContain("fallback pull error");
    });

    it("fails on an HTTP-200 pull error without a streamed body", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
        text: async () => '{"error":"registry rejected digest"}',
      });

      const result = await createTorContainer();

      expect(result.message).toContain("registry rejected digest");
    });

    it("fails on a trailing pull error without a newline", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('{"error":"trailing failure"}'),
          );
          controller.close();
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body });

      const result = await createTorContainer();

      expect(result.message).toContain("trailing failure");
    });

    it("accepts a clean streamed pull response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('{"status":"complete"}\n'),
          );
          controller.close();
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: "newtor123" }),
      });
      mockFetch.mockResolvedValueOnce({ status: 204 });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
    });

    it("cancels an oversized Docker progress event", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(4_097)));
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body });

      const result = await createTorContainer();

      expect(result).toEqual({
        success: false,
        message:
          "Failed to pull Tor image: Docker pull response contained an oversized progress event",
      });
    });

    it("should handle tor image pull failure", async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "cannot pull tor image",
      });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to pull Tor image");
    });

    it("should use project name from existing frontend container", async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "Done",
      });

      // Existing frontend container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: "frontend1",
            Names: ["/myproj-frontend-1"],
            State: "running",
          },
        ],
      });

      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: "tor-new" }),
      });

      // Start
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      const createCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("containers/create"),
      );
      if (!createCall) throw new Error("Tor create request was not issued");
      expect(createCall[0]).toContain("myproj-tor");
    });

    it("should fall back to default project when backend/frontend name cannot be parsed for tor", async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "Done",
      });

      // Name matches includes check but fails extraction regex
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: "invalid-name",
            Names: ["/-backend-1"],
            State: "running",
          },
        ],
      });

      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: "tor-fallback" }),
      });

      // Start
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      const createCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("containers/create"),
      );
      if (!createCall) throw new Error("Tor create request was not issued");
      expect(createCall[0]).toContain("sanctuary-tor");
    });

    it("should handle tor container create failure", async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "Done",
      });

      // List containers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Create fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "create tor failed",
      });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to create Tor container");
    });

    it("should handle tor container start failure after creation", async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "Done",
      });

      // List containers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: "tor-created" }),
      });

      // Start fails
      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => "tor start failed",
      });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain("failed to start");
    });
  });
}
