import { describe, expect, it } from "vitest";
import {
  createTorContainer,
  mockFetch,
  ownedTorInspect,
  ownedTorSummary,
  TOR_ID,
  TOR_OWNERSHIP_LABELS,
} from "./dockerTestHarness";

export function registerDockerTorCreateContracts(): void {
  describe("createTorContainer", () => {
    it("should return success if already running", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [ownedTorSummary("running")],
      });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      expect(result.message).toContain("already running");
    });

    it("should start existing tor container when it exists but is stopped", async () => {
      // Initial status check (exists but not running)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [ownedTorSummary("exited")],
      });
      // startTor() internal status check (exists but not running)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [ownedTorSummary("exited")],
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

      // Create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: TOR_ID }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
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
        Labels: TOR_OWNERSHIP_LABELS,
      });
      expect(createCall[0]).toContain("name=sanctuary-tor");
      expect(mockFetch.mock.calls.at(-1)?.[0]).toContain(
        `/containers/${TOR_ID}/start`,
      );
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: TOR_ID }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
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

    it("does not derive Tor ownership from another project's container name", async () => {
      // Status check
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

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "Done",
      });

      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: TOR_ID }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
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
      expect(createCall[0]).not.toContain("myproj-tor");
    });

    it("uses the explicit manifest project when unrelated names cannot be parsed", async () => {
      // Status check
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

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "Done",
      });

      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: TOR_ID }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
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

    it("recovers an exact created container after the create response is lost", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockRejectedValueOnce(new Error("create response lost"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({ status: 204 });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      const inspectCalls = mockFetch.mock.calls.filter((call) =>
        /\/containers\/(?:sanctuary-tor|[a-f0-9]{64})\/json$/.test(
          String(call[0]),
        ),
      );
      expect(inspectCalls.map((call) => call[0])).toEqual([
        expect.stringContaining("/containers/sanctuary-tor/json"),
        expect.stringContaining(`/containers/${TOR_ID}/json`),
      ]);
      expect(mockFetch.mock.calls.at(-1)?.[0]).toContain(
        `/containers/${TOR_ID}/start`,
      );
    });

    it("recovers by exact name when a successful create response body is lost", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("create body lost");
        },
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({ status: 204 });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls.at(-1)?.[0]).toContain(
        `/containers/${TOR_ID}/start`,
      );
    });

    it("recovers by exact name when Docker returns a non-immutable create ID", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: "short-id" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({ status: 204 });

      await expect(createTorContainer()).resolves.toMatchObject({ success: true });
    });

    it("uses the fallback error after an empty failed post-create start response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: TOR_ID }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => undefined,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ownedTorInspect(),
      });

      await expect(createTorContainer()).resolves.toEqual({
        success: false,
        message: "Container created but failed to start: unknown Docker start failure",
      });
    });

    it.each([
      {
        caseName: "a spoofed valid ID",
        returnedId: "d".repeat(64),
        inspect: ownedTorInspect(),
      },
      {
        caseName: "a mismatched ownership tuple",
        returnedId: TOR_ID,
        inspect: ownedTorInspect({
          Config: {
            Labels: {
              ...TOR_OWNERSHIP_LABELS,
              "io.sanctuary.deployment-id": "deploy-foreign",
            },
          },
        }),
      },
      {
        caseName: "a mismatched exact name",
        returnedId: TOR_ID,
        inspect: ownedTorInspect({ Name: "/foreign-tor" }),
      },
      {
        caseName: "an already-running state",
        returnedId: TOR_ID,
        inspect: ownedTorInspect({
          State: {
            Status: "running",
            Running: true,
            Paused: false,
            Restarting: false,
            Dead: false,
            StartedAt: "2026-09-01T00:00:01.000Z",
          },
        }),
      },
    ])(
      "refuses a successful create response with $caseName",
      async ({ returnedId, inspect }) => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Id: returnedId }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => inspect,
        });

        const result = await createTorContainer();

        expect(result.success).toBe(false);
        expect(
          mockFetch.mock.calls.some((call) =>
            String(call[0]).endsWith("/start"),
          ),
        ).toBe(false);
      },
    );

    it("refuses response-loss recovery when the ownership tuple differs", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockRejectedValueOnce(new Error("create response lost"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          ownedTorInspect({
            Config: {
              Labels: {
                ...TOR_OWNERSHIP_LABELS,
                "io.sanctuary.owner-id": "foreign-owner",
              },
            },
          }),
      });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(
        mockFetch.mock.calls.some((call) => String(call[0]).endsWith("/start")),
      ).toBe(false);
    });

    it("refuses response-loss recovery when the exact name is replaced between inspections", async () => {
      const replacementId = "c".repeat(64);
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockRejectedValueOnce(new Error("create response lost"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect({ Id: replacementId }),
      });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(
        mockFetch.mock.calls.some((call) => String(call[0]).endsWith("/start")),
      ).toBe(false);
    });

    it("fails closed when exact-name response-loss recovery is ambiguous", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockRejectedValueOnce(new Error("create response lost"));
      mockFetch.mockResolvedValueOnce({ ok: false, status: 409 });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain("inspect failed");
      expect(
        mockFetch.mock.calls.some((call) => String(call[0]).endsWith("/start")),
      ).toBe(false);
    });

    it.each(["running", "exited"])(
      "refuses response-loss recovery from an ambiguous %s container state",
      async (state) => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
        mockFetch.mockRejectedValueOnce(new Error("create response lost"));
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () =>
            ownedTorInspect({
              State: {
                Status: state,
                Running: state === "running",
                Paused: false,
                Restarting: false,
                Dead: false,
                StartedAt: "",
              },
            }),
        });

        const result = await createTorContainer();

        expect(result.success).toBe(false);
        expect(
          mockFetch.mock.calls.some((call) =>
            String(call[0]).endsWith("/start"),
          ),
        ).toBe(false);
      },
    );

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

      // Create fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "create tor failed",
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

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

      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: TOR_ID }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect(),
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
