import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/hardwareWalletCapabilities", async importOriginal => ({
  ...await importOriginal<typeof import("../../../src/services/hardwareWalletCapabilities")>(),
  assertWalletHardwareCapabilityById: vi.fn(),
}));
import type { Express } from "express";
import request from "supertest";
import {
  ApiError,
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  InvalidPsbtError,
  NotFoundError,
} from "../../../src/errors/ApiError";
import { ErrorCodes } from "../../../src/errors";
import {
  agentContext,
  createAgentRouteTestApp,
  fundingDraftPayload,
  mockAuditLog,
  mockCreateDraft,
  mockCreateFundingAttempt,
  mockCreateTransaction,
  mockDispatchDraftCreatedPostCommitNotifications,
  mockEnforceAgentFundingPolicy,
  mockEvaluatePolicies,
  mockEvaluateRejectedFundingAttemptAlert,
  mockGetDraft,
  mockMarkAgentFundingDraftCreated,
  mockMarkFundingOverrideUsed,
  mockRequireAgentFundingDraftAccess,
  mockRunDraftCreatedSideEffects,
  mockUpdateDraft,
  mockValidateAgentFundingDraftSubmission,
  mockVerifyOperationalReceiveAddress,
  mockWithAgentFundingTransaction,
  patchDraftSignature,
  postFundingDraft,
  resetAgentRouteMocks,
  signedFundingDraftPayload,
} from "./agentRoutes.testHarness";

describe("Agent Routes funding drafts", () => {
  let app: Express;

  beforeAll(() => {
    app = createAgentRouteTestApp();
  });

  beforeEach(() => {
    resetAgentRouteMocks();
  });

  it("lets an agent update its own funding draft signature", async () => {
    const response = await patchDraftSignature(app).send({
      signedPsbtBase64: "cHNidP8agentSigned",
    });

    expect(response.status).toBe(200);
    expect(mockGetDraft).toHaveBeenCalledWith("funding-wallet", "draft-agent");
    expect(mockValidateAgentFundingDraftSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        fundingWalletId: "funding-wallet",
        operationalWalletId: "operational-wallet",
        signerDeviceId: "agent-device",
        recipient: "tb1qrecipient",
        amount: "10000",
        psbtBase64: "cHNi",
        signedPsbtBase64: "cHNidP8agentSigned",
        allowedDraftLockId: "draft-agent",
      }),
    );
    expect(mockUpdateDraft).toHaveBeenCalledWith(
      "funding-wallet",
      "draft-agent",
      {
        signedPsbtBase64: "cHNidP8agentSigned",
        signedDeviceId: "agent-device",
        status: "partial",
      },
    );
  });

  it("rejects funding draft signatures when the agent has no signer device", async () => {
    (agentContext as any).signerDeviceId = null;

    const response = await patchDraftSignature(app).send({
      signedPsbtBase64: "cHNidP8agentSigned",
    });

    expect(response.status).toBe(403);
    expect(mockGetDraft).toHaveBeenCalledWith("funding-wallet", "draft-agent");
    expect(mockValidateAgentFundingDraftSubmission).not.toHaveBeenCalled();
    expect(mockUpdateDraft).not.toHaveBeenCalled();
  });

  it("creates a requester-only agent funding draft with notification metadata from the credential context", async () => {
    const payload = fundingDraftPayload({
      selectedUtxoIds: ["utxo-1"],
      label: "Agent refill",
    });

    const response = await postFundingDraft(app).send(payload);

    expect(response.status).toBe(201);
    expect(mockRequireAgentFundingDraftAccess).toHaveBeenCalledWith(
      agentContext,
      "funding-wallet",
      "operational-wallet",
    );
    expect(mockVerifyOperationalReceiveAddress).toHaveBeenCalledWith({
      operationalWalletId: "operational-wallet",
      address: "tb1qrecipient",
    });
    expect(mockValidateAgentFundingDraftSubmission).not.toHaveBeenCalled();
    expect(mockEnforceAgentFundingPolicy).toHaveBeenCalledWith(
      "agent-1",
      "operational-wallet",
      BigInt(10000),
    );
    expect(mockEvaluatePolicies).toHaveBeenCalledWith({
      walletId: "funding-wallet",
      userId: "user-1",
      recipient: "tb1qrecipient",
      amount: BigInt(10000),
    });
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      "funding-wallet",
      "tb1qrecipient",
      10000,
      5,
      expect.objectContaining({
        selectedUtxoIds: ["utxo-1"],
      }),
    );
    expect(mockWithAgentFundingTransaction).toHaveBeenCalledWith(
      "agent-1",
      expect.any(Function),
    );
    expect(mockCreateDraft).toHaveBeenCalledWith(
      "funding-wallet",
      "user-1",
      expect.objectContaining({
        recipient: "tb1qrecipient",
        amount: "10000",
        feeRate: 5,
        selectedUtxoIds: ["decoded-txid:0"],
        psbtBase64: "cHNi",
        fee: 500,
        totalInput: 10500,
        totalOutput: 10000,
        isRBF: false,
        agentId: "agent-1",
        agentOperationalWalletId: "operational-wallet",
        notificationCreatedByUserId: null,
        notificationCreatedByLabel: "Treasury Agent",
      }),
      expect.objectContaining({
        client: expect.any(Object),
        runSideEffects: false,
      }),
    );
    expect(mockDispatchDraftCreatedPostCommitNotifications).toHaveBeenCalledOnce();
    expect(mockRunDraftCreatedSideEffects).not.toHaveBeenCalled();
    expect(mockMarkAgentFundingDraftCreated).toHaveBeenCalledWith(
      "agent-1",
      expect.any(Date),
      expect.any(Object),
    );
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        keyId: "key-1",
        keyPrefix: "agt_prefix",
        fundingWalletId: "funding-wallet",
        operationalWalletId: "operational-wallet",
        draftId: "draft-agent",
        status: "accepted",
        amount: 10000n,
        feeRate: 5,
        recipient: "tb1qrecipient",
      }),
      expect.any(Object),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        username: "agent:Treasury Agent",
        action: "wallet.agent_funding_draft_submit",
        category: "wallet",
        details: expect.objectContaining({
          agentId: "agent-1",
          draftId: "draft-agent",
          fundingWalletId: "funding-wallet",
          operationalWalletId: "operational-wallet",
        }),
      }),
    );
    expect(response.body).toEqual({ id: "draft-agent", serialized: true });
  });

  it("enforces agent and vault policies against transaction effective amount", async () => {
    mockCreateTransaction.mockResolvedValueOnce({
      psbtBase64: "cHNi",
      fee: 500,
      totalInput: 20500,
      totalOutput: 15000,
      changeAmount: 5000,
      changeAddress: "tb1qchange",
      utxos: [
        {
          txid: "decoded-txid",
          vout: 0,
          address: "tb1qfunding",
          amount: 20500,
        },
      ],
      inputPaths: ["m/48'/1'/0'/2'/0/0"],
      effectiveAmount: 15000,
      decoyOutputs: undefined,
    });

    const response = await postFundingDraft(app).send(
      fundingDraftPayload({ sendMax: true }),
    );

    expect(response.status).toBe(201);
    expect(mockEnforceAgentFundingPolicy).toHaveBeenCalledWith(
      "agent-1",
      "operational-wallet",
      15000n,
    );
    expect(mockEvaluatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 15000n,
      }),
    );
    expect(mockCreateDraft).toHaveBeenCalledWith(
      "funding-wallet",
      "user-1",
      expect.objectContaining({
        amount: "15000",
        effectiveAmount: "15000",
        sendMax: true,
      }),
      expect.objectContaining({
        client: expect.any(Object),
        runSideEffects: false,
      }),
    );
    expect(mockDispatchDraftCreatedPostCommitNotifications).toHaveBeenCalledOnce();
    expect(mockRunDraftCreatedSideEffects).not.toHaveBeenCalled();
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        amount: 15000n,
      }),
      expect.any(Object),
    );
  });

  it("marks owner overrides as used when policy enforcement returns an override", async () => {
    const events: string[] = [];
    mockEnforceAgentFundingPolicy.mockResolvedValueOnce({
      overrideId: "override-1",
    });
    mockWithAgentFundingTransaction.mockImplementationOnce(
      async (_agentId, fn) => {
        events.push("lock-start");
        const result = await fn({ tx: true });
        events.push("lock-end");
        return result;
      },
    );
    mockMarkFundingOverrideUsed.mockImplementationOnce(async () => {
      events.push("mark-used");
    });

    const response = await postFundingDraft(app).send(fundingDraftPayload());

    expect(response.status).toBe(201);
    expect(mockCreateDraft).toHaveBeenCalledWith(
      "funding-wallet",
      "user-1",
      expect.objectContaining({
        label: "Agent funding request: Treasury Agent (owner override)",
      }),
      expect.objectContaining({
        client: expect.any(Object),
        runSideEffects: false,
      }),
    );
    expect(mockDispatchDraftCreatedPostCommitNotifications).toHaveBeenCalledOnce();
    expect(mockRunDraftCreatedSideEffects).not.toHaveBeenCalled();
    expect(mockMarkFundingOverrideUsed).toHaveBeenCalledWith(
      "override-1",
      "draft-agent",
      expect.any(Object),
    );
    expect(events).toEqual(["lock-start", "mark-used", "lock-end"]);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "wallet.agent_override_use",
        details: expect.objectContaining({
          agentId: "agent-1",
          overrideId: "override-1",
          draftId: "draft-agent",
        }),
      }),
    );
  });

  it("rejects invalid funding draft payloads before calling the service", async () => {
    const response = await request(app)
      .post("/api/v1/agent/wallets/funding-wallet/funding-drafts")
      .send({
        operationalWalletId: "operational-wallet",
        recipient: "tb1qrecipient",
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockCreateDraft).not.toHaveBeenCalled();
  });

  it("records rejected funding attempts with reason metadata", async () => {
    mockEnforceAgentFundingPolicy.mockRejectedValueOnce(
      new InvalidInputError("Agent daily funding limit would be exceeded"),
    );

    const response = await postFundingDraft(app).send(
      signedFundingDraftPayload({ amount: "10000" }),
    );

    expect(response.status).toBe(400);
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        keyId: "key-1",
        keyPrefix: "agt_prefix",
        fundingWalletId: "funding-wallet",
        operationalWalletId: "operational-wallet",
        status: "rejected",
        reasonCode: "policy_daily_limit",
        reasonMessage: "Agent daily funding limit would be exceeded",
        amount: 10000n,
        feeRate: 5,
        recipient: "tb1qrecipient",
      }),
    );
    expect(mockEvaluateRejectedFundingAttemptAlert).toHaveBeenCalledWith(
      "agent-1",
      "policy_daily_limit",
    );
  });

  it("rejects requester drafts to addresses outside the linked operational wallet", async () => {
    mockVerifyOperationalReceiveAddress.mockResolvedValueOnce({
      walletId: "operational-wallet",
      address: "tb1qexternal",
      verified: false,
      derivationPath: null,
      index: null,
    });

    await postFundingDraft(app)
      .send(fundingDraftPayload({ recipient: "tb1qexternal" }))
      .expect(400);
    expect(mockCreateTransaction).not.toHaveBeenCalled();
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        reasonCode: "policy_destination_mismatch",
        recipient: "tb1qexternal",
      }),
    );
  });

  it("rejects non-decimal amount strings before building the transaction", async () => {
    await postFundingDraft(app)
      .send(fundingDraftPayload({ amount: "1e3" }))
      .expect(400);
    expect(mockCreateTransaction).not.toHaveBeenCalled();
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        reasonCode: "invalid_amount",
        amount: null,
        feeRate: 5,
        recipient: "tb1qrecipient",
      }),
    );
  });

  it("rejects malformed decoy output requests before draft creation", async () => {
    const response = await postFundingDraft(app).send(
      fundingDraftPayload({
        decoyOutputs: { enabled: true, count: 10, address: "tb1qexternal" },
      }),
    );
    expect(response.status).toBe(400);
    expect(mockCreateTransaction).not.toHaveBeenCalled();
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(mockCreateFundingAttempt).not.toHaveBeenCalled();
  });

  it("rejects funding drafts with out-of-range fee rates before validation", async () => {
    const response = await postFundingDraft(app).send(
      signedFundingDraftPayload({
        amount: "not-sats",
        feeRate: "not-a-number",
      }),
    );
    expect(response.status).toBe(400);
    expect(mockValidateAgentFundingDraftSubmission).not.toHaveBeenCalled();
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        reasonCode: "fee_rate_out_of_bounds",
        amount: null,
        feeRate: null,
        recipient: "tb1qrecipient",
      }),
    );
  });

  it("records validation failures with normalized reason codes and truncated metadata", async () => {
    mockCreateTransaction.mockRejectedValueOnce(
      new InvalidPsbtError("bad PSBT bytes"),
    );

    await postFundingDraft(app).send(fundingDraftPayload()).expect(400);
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "invalid_psbt",
        amount: 10000n,
        feeRate: 5,
        recipient: "tb1qrecipient",
      }),
    );

    mockCreateTransaction.mockRejectedValueOnce(
      new ConflictError("locked by another draft"),
    );
    await postFundingDraft(app).send(fundingDraftPayload()).expect(409);
    expect(mockCreateFundingAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reasonCode: "utxo_locked",
      }),
    );

    mockCreateTransaction.mockRejectedValueOnce(
      new InvalidInputError("metadata failed validation"),
    );
    await postFundingDraft(app).send(fundingDraftPayload()).expect(400);

    expect(mockCreateFundingAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reasonCode: "invalid_input",
        amount: 10000n,
      }),
    );
  });

  it.each([
    ["Agent per-request cap exceeded", "policy_max_funding_amount"],
    [
      "Agent operational balance cap exceeded",
      "policy_operational_balance_cap",
    ],
    ["Agent funding cooldown is still active", "policy_cooldown"],
    ["Agent weekly funding limit would be exceeded", "policy_weekly_limit"],
    ["Agent is not active", "agent_inactive"],
    [
      "recipient must belong to the linked operational wallet",
      "policy_destination_mismatch",
    ],
    ["PSBT spends a frozen funding-wallet UTXO", "utxo_frozen"],
  ])(
    'classifies rejected funding attempt message "%s"',
    async (message, reasonCode) => {
      mockEnforceAgentFundingPolicy.mockRejectedValueOnce(
        new InvalidInputError(message),
      );

      await postFundingDraft(app).send(signedFundingDraftPayload()).expect(400);
      expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCode,
        }),
      );
    },
  );

  it("classifies generic API and unexpected rejection errors", async () => {
    mockEnforceAgentFundingPolicy.mockRejectedValueOnce(
      new ApiError("Custom API failure", 418, "EXTERNAL_SERVICE_ERROR" as any),
    );

    await postFundingDraft(app).send(signedFundingDraftPayload()).expect(418);

    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "external_service_error",
      }),
    );
    mockEnforceAgentFundingPolicy.mockRejectedValueOnce(
      new Error("database exploded"),
    );
    await postFundingDraft(app).send(signedFundingDraftPayload()).expect(500);
    expect(mockCreateFundingAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reasonCode: "unexpected_error",
      }),
    );
  });

  it("surfaces draft creation anomalies and swallows attempt-recording failures", async () => {
    mockWithAgentFundingTransaction.mockResolvedValueOnce(null);
    await postFundingDraft(app).send(signedFundingDraftPayload()).expect(400);
    mockCreateFundingAttempt.mockRejectedValueOnce(
      new Error("attempt store unavailable"),
    );
    mockCreateTransaction.mockRejectedValueOnce(
      new NotFoundError("Funding wallet not found"),
    );

    await postFundingDraft(app).send(fundingDraftPayload()).expect(404);
  });

  it("rejects signature updates for drafts outside the authenticated agent boundary", async () => {
    mockGetDraft.mockResolvedValueOnce({
      id: "draft-agent",
      agentId: "other-agent",
      agentOperationalWalletId: "operational-wallet",
      recipient: "tb1qrecipient",
      amount: BigInt(10000),
      psbtBase64: "cHNi",
    });
    const response = await patchDraftSignature(app).send({
      signedPsbtBase64: "cHNidP8agentSigned",
    });
    expect(response.status).toBe(403);
    expect(mockUpdateDraft).not.toHaveBeenCalled();
  });

  it("returns forbidden when the agent credential is not scoped to the wallet pair", async () => {
    mockRequireAgentFundingDraftAccess.mockImplementationOnce(() => {
      throw new ForbiddenError(
        "Agent API key is not scoped for this funding wallet",
      );
    });
    const response = await request(app)
      .post("/api/v1/agent/wallets/other-wallet/funding-drafts")
      .send(signedFundingDraftPayload());
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "Agent API key is not scoped for this funding wallet",
    );
    expect(mockCreateDraft).not.toHaveBeenCalled();
  });
});
