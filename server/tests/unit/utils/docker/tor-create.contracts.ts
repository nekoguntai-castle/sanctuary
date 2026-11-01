import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTorContainer,
  mockFetch,
  ownedTorInspect,
  ownedTorSummary,
  TOR_ID,
  TOR_OWNERSHIP_LABELS,
} from "./dockerTestHarness";

const EARLIER_RUN_LABELS = {
  ...TOR_OWNERSHIP_LABELS,
  "io.sanctuary.created-at": "2026-08-01T00:00:00.000Z",
  "io.sanctuary.created-by-release": "v0.8.60",
  "io.sanctuary.created-by-commit": "c".repeat(40),
  "io.sanctuary.creation-run-id": "run-earlier",
};

export function registerDockerTorCreateContracts(): void {
  describe("createTorContainer", () => {
    // CI exports a lane SANCTUARY_IMAGE_TAG; these contracts start from the
    // default tag and set one explicitly where they need it.
    let callerImageTag: string | undefined;
    beforeEach(() => {
      callerImageTag = process.env.SANCTUARY_IMAGE_TAG;
      delete process.env.SANCTUARY_IMAGE_TAG;
    });
    afterEach(() => {
      if (callerImageTag === undefined) delete process.env.SANCTUARY_IMAGE_TAG;
      else process.env.SANCTUARY_IMAGE_TAG = callerImageTag;
    });

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

      // Local image check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "{}",
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
      const imageCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === "string" && call[0].includes("/images/"),
      );
      const createCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("/containers/create"),
      );
      if (!imageCall || !createCall)
        throw new Error("Tor image check/create requests were not issued");
      // The repo-owned image is built locally; nothing is pulled from a registry.
      expect(imageCall[0]).toContain("/images/sanctuary-tor%3Alocal/json");
      expect(imageCall[1]?.method).toBe("GET");
      expect(imageCall[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(
        mockFetch.mock.calls.some(
          (call) => typeof call[0] === "string" && call[0].includes("/images/create"),
        ),
      ).toBe(false);
      const body = JSON.parse(String(createCall[1]?.body));
      expect(body).toMatchObject({
        Image: "sanctuary-tor:local",
        Labels: TOR_OWNERSHIP_LABELS,
      });
      expect(body.Env).toBeUndefined();
      expect(createCall[0]).toContain("name=sanctuary-tor");
      expect(mockFetch.mock.calls.at(-1)?.[0]).toContain(
        `/containers/${TOR_ID}/start`,
      );
    });

    it("refuses to create Tor when the local image has not been built", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" });

      const result = await createTorContainer();

      expect(result).toEqual({
        success: false,
        message:
          "Tor image sanctuary-tor:local is not built; run ./start.sh --with-tor to build and start Tor",
      });
      expect(
        mockFetch.mock.calls.some(
          (call) => typeof call[0] === "string" && call[0].includes("/containers/create"),
        ),
      ).toBe(false);
    });

    it("reports a failed image check with Docker's bounded error text", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "x".repeat(5_000),
      });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        `Failed to check Tor image sanctuary-tor:local: ${"x".repeat(4_096)}`,
      );
    });

    it("falls back to the status when a failed image check has no body", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" });

      const result = await createTorContainer();

      expect(result.message).toBe("Failed to check Tor image sanctuary-tor:local: status 503");
    });

    it("reports a Docker proxy that cannot answer the image check", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockRejectedValueOnce(new Error("proxy unreachable"));

      const result = await createTorContainer();

      expect(result).toEqual({ success: false, message: "proxy unreachable" });
    });

    it("uses this deployment's image tag and rejects an unsafe one", async () => {
      process.env.SANCTUARY_IMAGE_TAG = "rc078rc1";
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" });
      const tagged = await createTorContainer();
      expect(tagged.message).toContain("sanctuary-tor:rc078rc1 is not built");
      expect(String(mockFetch.mock.calls.at(-1)?.[0])).toContain(
        "/images/sanctuary-tor%3Arc078rc1/json",
      );

      process.env.SANCTUARY_IMAGE_TAG = "   ";
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" });
      const blank = await createTorContainer();
      expect(blank.message).toContain("sanctuary-tor:local is not built");

      process.env.SANCTUARY_IMAGE_TAG = `a${"b".repeat(127)}`;
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" });
      const longest = await createTorContainer();
      expect(longest.message).toContain(`sanctuary-tor:a${"b".repeat(127)} is not built`);

      for (const unsafeTag of ["../evil", `a${"b".repeat(128)}`]) {
        process.env.SANCTUARY_IMAGE_TAG = unsafeTag;
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        const unsafe = await createTorContainer();
        expect(unsafe).toEqual({ success: false, message: "SANCTUARY_IMAGE_TAG is invalid" });
      }
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

      // Local image check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "{}",
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

      // Local image check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "{}",
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

    it("fails to create without the per-run provenance environment", async () => {
      delete process.env.SANCTUARY_OPERATION_RUN_ID;

      await expect(createTorContainer()).resolves.toEqual({
        success: false,
        message: "SANCTUARY_OPERATION_RUN_ID is required for Tor ownership",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("adopts a created container with the same identity but earlier-run provenance after a lost create response", async () => {
      const earlier = ownedTorInspect({ Config: { Labels: EARLIER_RUN_LABELS } });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockRejectedValueOnce(new Error("create response lost"));
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => earlier });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => earlier });
      mockFetch.mockResolvedValueOnce({ status: 204 });

      await expect(createTorContainer()).resolves.toMatchObject({ success: true });
      expect(mockFetch.mock.calls.at(-1)?.[0]).toContain(`/containers/${TOR_ID}/start`);
    });

    it("refuses a post-create inspect whose identity matches but provenance does not", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "Done" });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ Id: TOR_ID }) });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ownedTorInspect({ Config: { Labels: EARLIER_RUN_LABELS } }),
      });

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(
        mockFetch.mock.calls.some((call) => String(call[0]).endsWith("/start")),
      ).toBe(false);
    });

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

      // Local image check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "{}",
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

      // Local image check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "{}",
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
