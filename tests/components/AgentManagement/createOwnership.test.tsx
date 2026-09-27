import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentManagement } from "../../../src/components/AgentManagement";
import * as adminApi from "../../../src/api/admin";
vi.mock("../../../src/api/admin", () => ({ getWalletAgents: vi.fn(), getWalletAgentOptions: vi.fn(), createWalletAgent: vi.fn(), revokeWalletAgent: vi.fn() }));
const options = {
  users: [
    {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      emailVerified: true,
      isAdmin: false,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
    },
  ],
  wallets: [
    {
      id: "funding-1",
      name: "Funding",
      type: "multi_sig",
      network: "testnet3",
      accessUserIds: ["user-1"],
      deviceIds: ["device-1"],
    },
    {
      id: "operational-1",
      name: "Operational",
      type: "single_sig",
      network: "testnet3",
      accessUserIds: ["user-1"],
      deviceIds: [],
    },
  ],
  devices: [
    {
      id: "device-1",
      label: "Agent Signer",
      fingerprint: "aabbccdd",
      type: "ledger",
      userId: "user-1",
      walletIds: ["funding-1"],
    },
  ],
};
const agent = {
  id: "agent-1",
  userId: "user-1",
  name: "Treasury Agent",
  status: "active",
  fundingWalletId: "funding-1",
  operationalWalletId: "operational-1",
  signerDeviceId: "device-1",
  maxFundingAmountSats: "100000",
  maxOperationalBalanceSats: null,
  dailyFundingLimitSats: null,
  weeklyFundingLimitSats: null,
  cooldownMinutes: 10,
  minOperationalBalanceSats: "25000",
  largeOperationalSpendSats: "75000",
  largeOperationalFeeSats: "5000",
  repeatedFailureThreshold: 3,
  repeatedFailureLookbackMinutes: 60,
  alertDedupeMinutes: 120,
  requireHumanApproval: true,
  notifyOnOperationalSpend: true,
  pauseOnUnexpectedSpend: false,
  lastFundingDraftAt: null,
  createdAt: "2026-04-16T00:00:00.000Z",
  updatedAt: "2026-04-16T00:00:00.000Z",
  revokedAt: null,
  user: { id: "user-1", username: "alice", isAdmin: false },
  fundingWallet: {
    id: "funding-1",
    name: "Funding",
    type: "multi_sig",
    network: "testnet3",
  },
  operationalWallet: {
    id: "operational-1",
    name: "Operational",
    type: "single_sig",
    network: "testnet3",
  },
  signerDevice: {
    id: "device-1",
    label: "Agent Signer",
    fingerprint: "aabbccdd",
  },
  apiKeys: [],
} as unknown as adminApi.WalletAgentMetadata;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(adminApi.getWalletAgents).mockResolvedValue([agent]);
  vi.mocked(adminApi.getWalletAgentOptions).mockResolvedValue(options as adminApi.AgentManagementOptions);
  vi.mocked(adminApi.createWalletAgent).mockResolvedValue(agent);
});

function mount(strict = false) {
  const router = createMemoryRouter([{ path: "/admin/agents", element: <AgentManagement /> }, { path: "/elsewhere", element: <div>Chosen destination</div> }, { path: "/admin/agent-wallets", element: <div>Agent destination</div> }], { initialEntries: ["/elsewhere", "/admin/agents"], initialIndex: 1 });
  render(strict ? <React.StrictMode><RouterProvider router={router}/></React.StrictMode> : <RouterProvider router={router}/>);
  return router;
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Add Agent Wallet" }));
  await user.type(screen.getByPlaceholderText("Treasury funding agent"), "Ops Agent");
  await user.selectOptions(screen.getAllByRole("combobox")[0], "user-1");
  await user.click(screen.getByRole("button", { name: "Next" }));
  const selects = screen.getAllByRole("combobox");
  await user.selectOptions(selects[0], "funding-1");
  await user.selectOptions(selects[1], "operational-1");
  await user.selectOptions(selects[2], "device-1");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getAllByRole("button", { name: "Add Agent Wallet" }).at(-1)!);
}

async function settle(operation: ReturnType<typeof deferred<adminApi.WalletAgentMetadata>>, failure = false) {
  await act(async () => {
    if (failure)
      operation.reject(new Error("Creation unavailable"));
    else
      operation.resolve(agent);
  });
}

it.each([false, true])("retires a pending create on browser Back (failure=%s)", async (failure) => {
  const request = deferred<adminApi.WalletAgentMetadata>();
  vi.mocked(adminApi.createWalletAgent).mockReturnValue(request.promise);
  const router = mount();
  await submit(userEvent.setup());
  const loads = vi.mocked(adminApi.getWalletAgents).mock.calls.length;
  await act(async () => {
    await router.navigate(-1);
  });
  await settle(request, failure);
  expect(router.state.location.pathname).toBe("/elsewhere");
  expect(adminApi.getWalletAgents).toHaveBeenCalledTimes(loads);
});

it.each([false, true])("retires create reload after browser Back (failure=%s)", async (failure) => {
  const request = deferred<adminApi.WalletAgentMetadata>();
  vi.mocked(adminApi.createWalletAgent).mockReturnValue(request.promise);
  const router = mount();
  await submit(userEvent.setup());
  const reload = deferred<adminApi.WalletAgentMetadata[]>();
  vi.mocked(adminApi.getWalletAgents).mockReturnValue(reload.promise);
  await settle(request);
  await act(async () => {
    await router.navigate(-1);
  });
  await act(async () => {
    if (failure)
      reload.reject(new Error("Reload unavailable"));
    else
      reload.resolve([]);
  });
  expect(router.state.location.pathname).toBe("/elsewhere");
});

it.each([false, true])("current create navigates, including StrictMode=%s", async (strict) => {
  const router = mount(strict);
  await submit(userEvent.setup());
  await waitFor(() => expect(router.state.location.pathname).toBe("/admin/agent-wallets"));
  expect(adminApi.createWalletAgent).toHaveBeenCalledOnce();
});

it("preserves navigation after a swallowed current reload failure", async () => {
  const request = deferred<adminApi.WalletAgentMetadata>();
  vi.mocked(adminApi.createWalletAgent).mockReturnValue(request.promise);
  const router = mount();
  await submit(userEvent.setup());
  vi.mocked(adminApi.getWalletAgents).mockRejectedValue(new Error("Reload unavailable"));
  await settle(request);
  expect(router.state.location.pathname).toBe("/admin/agent-wallets");
});

it("retries a bootstrap failure through the real Retry button", async () => {
  vi.mocked(adminApi.getWalletAgents).mockRejectedValueOnce(new Error("Bootstrap unavailable"));
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Add Agent Wallet" })).toBeEnabled();
});

it.each(["close", "backdrop", "escape"])("modal %s preserves page-owned accepted creation", async (dismissal) => {
  const request = deferred<adminApi.WalletAgentMetadata>();
  vi.mocked(adminApi.createWalletAgent).mockReturnValue(request.promise);
  const router = mount();
  const user = userEvent.setup();
  await submit(user);
  if (dismissal === "close")
    await user.click(screen.getByRole("button", { name: "Close" }));
  else if (dismissal === "escape")
    await user.keyboard("{Escape}");
  else
    await user.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await settle(request);
  expect(router.state.location.pathname).toBe("/admin/agent-wallets");
});

it("shows a current create failure and allows retry", async () => {
  vi.mocked(adminApi.createWalletAgent).mockRejectedValueOnce(new Error("Creation unavailable"));
  const router = mount();
  const user = userEvent.setup();
  await submit(user);
  expect(await screen.findByText("Creation unavailable")).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Add Agent Wallet" }).at(-1)!);
  await waitFor(() => expect(router.state.location.pathname).toBe("/admin/agent-wallets"));
});

it("create cleanup preserves a later pending revoke", async () => {
  const request = deferred<adminApi.WalletAgentMetadata>();
  vi.mocked(adminApi.createWalletAgent).mockReturnValue(request.promise);
  vi.mocked(adminApi.revokeWalletAgent).mockReturnValue(new Promise(() => {
  }));
  mount();
  const user = userEvent.setup();
  await submit(user);
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Revoke" }));
  await settle(request, true);
  expect(screen.getByRole("button", { name: "Revoke" })).toBeDisabled();
});

it.each([false, true])("new create supersedes earlier creation (old failure=%s)", async (failure) => {
  const old = deferred<adminApi.WalletAgentMetadata>();
  const latest = deferred<adminApi.WalletAgentMetadata>();
  vi.mocked(adminApi.createWalletAgent).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  vi.mocked(adminApi.revokeWalletAgent).mockReturnValue(new Promise(() => {
  }));
  const router = mount();
  const user = userEvent.setup();
  await submit(user);
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Revoke" }));
  await submit(user);
  await settle(old, failure);
  expect(router.state.location.pathname).toBe("/admin/agents");
  expect(screen.getAllByRole("button", { name: "Add Agent Wallet" }).at(-1)).toBeDisabled();
  expect(screen.queryByText("Creation unavailable")).not.toBeInTheDocument();
  await settle(latest);
  expect(router.state.location.pathname).toBe("/admin/agent-wallets");
});
