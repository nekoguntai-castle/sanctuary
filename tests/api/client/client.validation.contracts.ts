import { describe, expect, it } from "vitest";

import { FeeEstimatesSchema } from "../../../shared/schemas/bitcoinResponses";
import { ApiError, apiClient, mockFetch } from "./clientTestHarness";

const respondWith = (body: unknown) => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => "application/json" },
  });
};

export const registerApiClientValidationContracts = () => {
  describe("response validation", () => {
    const valid = { fastest: 18, halfHour: 12, hour: 8, economy: 3 };

    it("returns the parsed body when it matches the schema", async () => {
      respondWith(valid);

      const result = await apiClient.get("/bitcoin/fees", undefined, undefined, {
        schema: FeeEstimatesSchema,
      });

      expect(result).toEqual(valid);
    });

    it("rejects a body the schema does not accept", async () => {
      // The exact shape that crashed the dashboard: declared `number`, sent null.
      respondWith({ ...valid, fastest: null });

      await expect(
        apiClient.get("/bitcoin/fees", undefined, undefined, { schema: FeeEstimatesSchema }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it("names the offending field so the failure is diagnosable", async () => {
      respondWith({ ...valid, economy: "cheap" });

      await expect(
        apiClient.get("/bitcoin/fees", undefined, undefined, { schema: FeeEstimatesSchema }),
      ).rejects.toThrow(/economy/);
    });

    it("labels a whole-body failure as <root> rather than an empty path", async () => {
      // A body that is not an object at all fails with no path, and "": message
      // would read as a field named "".
      respondWith("not an object");

      await expect(
        apiClient.get("/bitcoin/fees", undefined, undefined, { schema: FeeEstimatesSchema }),
      ).rejects.toThrow(/<root>/);
    });

    it("passes the body through untouched when no schema is supplied", async () => {
      // Every other endpoint is still unvalidated; opting in must be the only
      // thing that changes behaviour.
      const nonsense = { fastest: null, whatever: true };
      respondWith(nonsense);

      await expect(apiClient.get("/bitcoin/fees")).resolves.toEqual(nonsense);
    });

    it("strips unknown keys rather than failing a newer server's response", async () => {
      respondWith({ ...valid, addedByANewerServer: 1 });

      const result = await apiClient.get("/bitcoin/fees", undefined, undefined, {
        schema: FeeEstimatesSchema,
      });

      expect(result).toEqual(valid);
    });
  });
};
