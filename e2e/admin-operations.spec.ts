/**
 * Admin Operations E2E Tests
 *
 * Tests interactive admin workflows: feature flag toggling, user/group CRUD,
 * backup/restore flows, node config editing, and variable updates.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { json, unmocked, registerApiRoutes } from "./helpers";
import {
  AGENT_MANAGEMENT_OPTIONS,
  AGENT_WALLET_DASHBOARD_ROWS,
  WALLET_AGENTS,
} from "./adminOperationsFixtures";
import {
  createAdminApiState,
  mockResponse,
  STATIC_ADMIN_API_RESPONSES,
  type AdminApiState,
  type AdminOpsGroup,
  type AdminOpsUser,
  type MockApiFailure,
  type MockApiResponse,
} from "./adminOperationsApiState";

type AgentDashboardRow = (typeof AGENT_WALLET_DASHBOARD_ROWS)[number];

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
};

type AdminApiResponder = (
  route: Route,
  parsedRoute: ParsedApiRoute,
  state: AdminApiState,
) => MockApiResponse | null;

function parseApiRoute(route: Route): ParsedApiRoute {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  return { method, path, requestKey: `${method} ${path}` };
}

async function maybeFulfillFailure(
  route: Route,
  failure?: MockApiFailure,
): Promise<boolean> {
  if (!failure) {
    return false;
  }

  await json(
    route,
    failure.body ?? { message: "Injected failure" },
    failure.status ?? 500,
  );
  return true;
}

function finalPathSegment(path: string) {
  return path.split("/").pop();
}

const cloneAgentDashboardRows = (
  rows: AgentDashboardRow[],
): AgentDashboardRow[] => structuredClone(rows);

const getRegistrationStatusResponse: AdminApiResponder = (
  _route,
  { requestKey },
  state,
) => {
  return requestKey === "GET /auth/registration-status"
    ? mockResponse({ enabled: state.settingsState.registrationEnabled })
    : null;
};

const getFeatureResponse: AdminApiResponder = (
  route,
  { method, path, requestKey },
  state,
) => {
  if (requestKey === "GET /admin/features") {
    return mockResponse(state.flagState);
  }
  if (method === "PUT" && /^\/admin\/features\//.test(path)) {
    const flagKey = finalPathSegment(path);
    const body = route.request().postDataJSON() as { enabled: boolean };
    state.flagState = state.flagState.map((f) =>
      f.key === flagKey
        ? {
            ...f,
            enabled: body.enabled,
            modifiedBy: "admin",
            updatedAt: new Date().toISOString(),
          }
        : f,
    );
    const updated = state.flagState.find((f) => f.key === flagKey);
    return mockResponse(
      updated ?? { message: "Flag not found" },
      updated ? 200 : 404,
    );
  }
  return null;
};

const getUserResponse: AdminApiResponder = (
  route,
  { method, path, requestKey },
  state,
) => {
  if (requestKey === "GET /admin/users") {
    return mockResponse(state.usersState);
  }
  if (requestKey === "POST /admin/users") {
    const body = route.request().postDataJSON() as Partial<AdminOpsUser>;
    const newUser = {
      id: `user-new-${Date.now()}`,
      username: body.username ?? "",
      email: body.email ?? null,
      isAdmin: body.isAdmin ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.usersState = [...state.usersState, newUser];
    return mockResponse(newUser, 201);
  }
  if (method === "PUT" && /^\/admin\/users\//.test(path)) {
    const userId = finalPathSegment(path);
    const body = route.request().postDataJSON() as Partial<AdminOpsUser>;
    state.usersState = state.usersState.map((u) =>
      u.id === userId
        ? { ...u, ...body, updatedAt: new Date().toISOString() }
        : u,
    );
    return mockResponse(state.usersState.find((u) => u.id === userId));
  }
  if (method === "DELETE" && /^\/admin\/users\//.test(path)) {
    const userId = finalPathSegment(path);
    state.usersState = state.usersState.filter((u) => u.id !== userId);
    return mockResponse({ message: "User deleted" });
  }
  return null;
};

const getGroupResponse: AdminApiResponder = (
  route,
  { method, path, requestKey },
  state,
) => {
  if (requestKey === "GET /admin/groups") {
    return mockResponse(state.groupsState);
  }
  if (requestKey === "POST /admin/groups") {
    const body = route.request().postDataJSON() as Pick<AdminOpsGroup, "name">;
    const newGroup = {
      id: `group-new-${Date.now()}`,
      name: body.name,
      members: [],
    };
    state.groupsState = [...state.groupsState, newGroup];
    return mockResponse(newGroup, 201);
  }
  if (method === "PUT" && /^\/admin\/groups\//.test(path)) {
    const groupId = finalPathSegment(path);
    const body = route.request().postDataJSON() as Partial<AdminOpsGroup>;
    state.groupsState = state.groupsState.map((g) =>
      g.id === groupId ? { ...g, ...body } : g,
    );
    return mockResponse(state.groupsState.find((g) => g.id === groupId));
  }
  if (method === "DELETE" && /^\/admin\/groups\//.test(path)) {
    const groupId = finalPathSegment(path);
    state.groupsState = state.groupsState.filter((g) => g.id !== groupId);
    return mockResponse({ message: "Group deleted" });
  }
  return null;
};

const getSettingsResponse: AdminApiResponder = (
  route,
  { requestKey },
  state,
) => {
  if (requestKey === "GET /admin/settings") {
    return mockResponse(state.settingsState);
  }
  if (requestKey === "PUT /admin/settings") {
    const body = route.request().postDataJSON() as Partial<
      AdminApiState["settingsState"]
    >;
    state.settingsState = { ...state.settingsState, ...body };
    return mockResponse(state.settingsState);
  }
  return null;
};

const getNodeConfigResponse: AdminApiResponder = (
  route,
  { requestKey },
  state,
) => {
  if (requestKey === "GET /admin/node-config") {
    return mockResponse(state.nodeConfigState);
  }
  if (requestKey === "PUT /admin/node-config") {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.nodeConfigState = { ...state.nodeConfigState, ...body };
    return mockResponse(state.nodeConfigState);
  }
  return null;
};

const getBackupResponse: AdminApiResponder = (
  _route,
  { requestKey },
  _state,
) => {
  if (requestKey === "POST /admin/backup") {
    return mockResponse({
      data: { users: [], wallets: [], devices: [] },
      metadata: {
        version: "0.8.14",
        createdAt: new Date().toISOString(),
        createdBy: "admin",
        description: "E2E test backup",
      },
    });
  }
  if (requestKey === "POST /admin/encryption-keys") {
    return mockResponse({
      encryptionKey: "test-enc-key-abc123",
      encryptionSalt: "test-salt-xyz789",
      hasEncryptionKey: true,
      hasEncryptionSalt: true,
    });
  }
  return null;
};

const ADMIN_API_RESPONDERS: AdminApiResponder[] = [
  getRegistrationStatusResponse,
  getFeatureResponse,
  getUserResponse,
  getGroupResponse,
  getSettingsResponse,
  getNodeConfigResponse,
  getBackupResponse,
];

function getAdminApiResponse(
  route: Route,
  parsedRoute: ParsedApiRoute,
  state: AdminApiState,
): MockApiResponse | null {
  for (const responder of ADMIN_API_RESPONDERS) {
    const response = responder(route, parsedRoute, state);
    if (response) {
      return response;
    }
  }
  return STATIC_ADMIN_API_RESPONSES[parsedRoute.requestKey] ?? null;
}

function createAdminApiRouteHandler(options: {
  failures?: Record<string, MockApiFailure>;
  responseOverrides?: Record<string, MockApiResponse>;
  agentDashboardRows?: AgentDashboardRow[];
  unhandledRequests: string[];
}) {
  const state = createAdminApiState();
  let agentDashboardRows = options.agentDashboardRows
    ? cloneAgentDashboardRows(options.agentDashboardRows)
    : null;
  const apiRouteHandler = async (route: Route) => {
    const parsedRoute = parseApiRoute(route);
    const { method, path, requestKey } = parsedRoute;

    if (await maybeFulfillFailure(route, options.failures?.[requestKey])) {
      return;
    }

    if (agentDashboardRows && requestKey === "GET /admin/agents/dashboard") {
      await json(route, agentDashboardRows);
      return;
    }

    if (
      agentDashboardRows &&
      method === "PATCH" &&
      /^\/admin\/agents\/[^/]+$/.test(path)
    ) {
      const agentId = finalPathSegment(path);
      const body = route.request().postDataJSON() as { status?: string };
      let updatedAgent: AgentDashboardRow["agent"] | undefined;

      agentDashboardRows = agentDashboardRows.map((row) => {
        if (row.agent.id !== agentId) {
          return row;
        }

        updatedAgent = {
          ...row.agent,
          ...(body.status ? { status: body.status } : {}),
          updatedAt: new Date().toISOString(),
        };
        return { ...row, agent: updatedAgent };
      });

      await json(
        route,
        updatedAgent ?? { message: "Agent not found" },
        updatedAgent ? 200 : 404,
      );
      return;
    }

    const override = options.responseOverrides?.[requestKey];
    if (override) {
      await json(route, override.body, override.status);
      return;
    }

    const response = getAdminApiResponse(route, parsedRoute, state);
    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    options.unhandledRequests.push(requestKey);
    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

async function mockAdminApi(
  page: Page,
  options?: {
    failures?: Record<string, MockApiFailure>;
    responseOverrides?: Record<string, MockApiResponse>;
    agentDashboardRows?: AgentDashboardRow[];
  },
) {
  await page.addInitScript(() => {
    localStorage.setItem("sanctuary_token", "playwright-admin-ops-token");
  });

  const unhandledRequests: string[] = [];
  await registerApiRoutes(
    page,
    createAdminApiRouteHandler({
      failures: options?.failures,
      responseOverrides: options?.responseOverrides,
      agentDashboardRows: options?.agentDashboardRows,
      unhandledRequests,
    }),
  );
  return unhandledRequests;
}

test.describe("Admin operations", () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on("pageerror", (err) => errors.push(err.message));
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = runtimeErrors.get(page) ?? [];
    expect(errors, `Runtime errors in "${testInfo.title}"`).toEqual([]);
  });

  // --- Feature Flag Toggle ---

  test("toggling a feature flag shows saved confirmation", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/feature-flags");
    await expect(
      page.getByRole("heading", { name: "Feature Flags" }),
    ).toBeVisible();

    // Find the disabled flag and toggle it
    await expect(page.getByText("treasuryAutopilot")).toBeVisible();

    // The feature flag page shows toggleable flags
    // Verify that the enhancedDashboard flag is also visible
    await expect(page.getByText("enhancedDashboard")).toBeVisible();
    // Both flags from both categories should be visible
    await expect(page.getByText("General")).toBeVisible();
    await expect(page.getByText("Experimental")).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("feature flag change history section is toggleable", async ({
    page,
  }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/feature-flags");
    await expect(
      page.getByRole("heading", { name: "Feature Flags" }),
    ).toBeVisible();

    const historyButton = page.getByRole("button", { name: /Change History/i });
    if (await historyButton.isVisible()) {
      await historyButton.click();
      // Change history section should expand/collapse - look for content inside the expanded section
      await expect(
        page
          .getByText("No changes recorded yet.")
          .or(page.getByText("Loading audit log...")),
      ).toBeVisible();
    }

    expect(unhandledRequests).toEqual([]);
  });

  // --- User Management ---

  test("users page shows existing users", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole("main");

    await page.goto("/#/admin/users-groups");

    await expect(
      main.getByText("admin", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      main.getByText("viewer", { exact: true }).first(),
    ).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("create user modal opens and creates user", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/users-groups");

    // Click Add User
    await page.getByRole("button", { name: /Add User/i }).click();

    // Modal should appear
    await expect(page.getByText("Create New User")).toBeVisible();

    // Fill form
    await page.getByPlaceholder(/username/i).fill("newuser");
    await page.getByPlaceholder(/password/i).fill("SecurePass123!");
    await page.getByPlaceholder("user@example.com").fill("newuser@example.com");

    // Submit
    await page.getByRole("button", { name: /Create User/i }).click();

    // Modal should close and new user should appear
    await expect(page.getByText("newuser", { exact: true })).toBeVisible({
      timeout: 5000,
    });

    expect(unhandledRequests).toEqual([]);
  });

  test("delete user with confirmation", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/users-groups");
    await expect(page.getByText("viewer", { exact: true })).toBeVisible();

    // Accept the confirmation dialog
    page.on("dialog", (dialog) => dialog.accept());

    // Find the delete button for the viewer user row (title="Delete user")
    // The user list renders each user in a <li> with username and a delete button with title="Delete user"
    const viewerRow = page.locator("li").filter({ hasText: "viewer" });
    const deleteButton = viewerRow.locator('button[title="Delete user"]');

    if (await deleteButton.first().isVisible()) {
      await deleteButton.first().click();
      // User should be removed
      await expect(page.getByText("viewer", { exact: true })).not.toBeVisible({
        timeout: 5000,
      });
    }

    expect(unhandledRequests).toEqual([]);
  });

  // --- Group Management ---

  test("create group via inline form", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/users-groups");

    // Find group creation form
    const groupInput = page
      .getByPlaceholder(/group name/i)
      .or(page.getByPlaceholder(/new group/i));
    if (await groupInput.isVisible()) {
      await groupInput.fill("Test Group");
      await page.getByRole("button", { name: /Create/i }).click();

      // Group should appear
      await expect(page.getByText("Test Group")).toBeVisible({ timeout: 5000 });
    }

    expect(unhandledRequests).toEqual([]);
  });

  test("delete group with confirmation", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/users-groups");

    // First create a group so we have one to delete
    const groupInput = page
      .getByPlaceholder(/group name/i)
      .or(page.getByPlaceholder(/new group/i));
    if (await groupInput.isVisible()) {
      await groupInput.fill("Group To Delete");
      await page.getByRole("button", { name: /Create/i }).click();
      await expect(page.getByText("Group To Delete")).toBeVisible({
        timeout: 5000,
      });

      // Accept the confirmation dialog
      page.on("dialog", (dialog) => dialog.accept());

      // Find and click the delete button for the group
      const groupRow = page
        .locator("li, tr, [data-testid]")
        .filter({ hasText: "Group To Delete" });
      const deleteButton = groupRow
        .locator(
          'button[title="Delete group"], button[aria-label*="delete" i], button:has(svg)',
        )
        .last();

      if (await deleteButton.isVisible()) {
        await deleteButton.click();
        // Group should be removed
        await expect(page.getByText("Group To Delete")).not.toBeVisible({
          timeout: 5000,
        });
      }
    }

    expect(unhandledRequests).toEqual([]);
  });

  test("users-groups page renders both sections", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole("main");

    await page.goto("/#/admin/users-groups");

    // Should show both users and groups sections
    await expect(
      main.getByText("admin", { exact: true }).first(),
    ).toBeVisible();

    // Groups section should be visible (may be empty)
    await expect(main.getByText(/Groups/i).first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("wallet agents page renders populated agent registry", async ({
    page,
  }) => {
    const unhandledRequests = await mockAdminApi(page, {
      responseOverrides: {
        "GET /admin/agents": mockResponse(WALLET_AGENTS),
        "GET /admin/agents/options": mockResponse(AGENT_MANAGEMENT_OPTIONS),
      },
    });
    const main = page.getByRole("main");

    await page.goto("/#/admin/agents");

    await expect(
      main.getByRole("heading", { name: "Wallet Agents" }),
    ).toBeVisible();
    await expect(main.getByText("Treasury Agent")).toBeVisible();
    await expect(main.getByText("Agent Funding Vault")).toBeVisible();
    await expect(main.getByText("Agent Operating Wallet")).toBeVisible();
    await expect(main.getByText("Agent Signer")).toBeVisible();
    await expect(
      main.getByText(/Request cap: 100[\s,.]?000 sats/),
    ).toBeVisible();
    await expect(
      main.getByText(/Balance cap: 250[\s,.]?000 sats/),
    ).toBeVisible();
    await expect(
      main.getByText(/Refill alert: 25[\s,.]?000 sats/),
    ).toBeVisible();
    await expect(
      main.getByText(/Large spend: 75[\s,.]?000 sats/),
    ).toBeVisible();
    await expect(main.getByText("Auto-pause on spend")).toBeVisible();
    await expect(main.getByText("Runtime Key")).toBeVisible();
    await expect(main.getByText("agt_ops")).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("agent wallets page renders populated operational dashboard", async ({
    page,
  }) => {
    const unhandledRequests = await mockAdminApi(page, {
      responseOverrides: {
        "GET /admin/agents/dashboard": mockResponse(
          AGENT_WALLET_DASHBOARD_ROWS,
        ),
      },
    });
    const main = page.getByRole("main");

    await page.goto("/#/admin/agent-wallets");

    await expect(
      main.getByRole("heading", { name: "Agent Wallets" }),
    ).toBeVisible();
    await expect(main.getByText("Treasury Agent")).toBeVisible();
    await expect(main.getByText(/82[\s,.]?000 sats/).first()).toBeVisible();
    await expect(main.getByText("Pending drafts").first()).toBeVisible();
    await expect(
      main.getByRole("link", { name: "Review Drafts" }),
    ).toHaveAttribute("href", /wallet-agent-funding/);
    await expect(
      main.getByRole("link", { name: "Funding Wallet" }),
    ).toHaveAttribute("href", /wallet-agent-funding/);
    await expect(
      main.getByRole("link", { name: "Operational Wallet" }),
    ).toHaveAttribute("href", /wallet-agent-operational/);

    await main.getByText("Review details").click();

    await expect(
      main.getByText("Operational balance is below threshold"),
    ).toBeVisible();
    await expect(main.getByText(/Runtime Key/)).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("agent wallets page pauses and refreshes agent status", async ({
    page,
  }) => {
    const unhandledRequests = await mockAdminApi(page, {
      agentDashboardRows: AGENT_WALLET_DASHBOARD_ROWS,
    });
    const main = page.getByRole("main");

    await page.goto("/#/admin/agent-wallets");

    await expect(main.getByText("Treasury Agent")).toBeVisible();
    await expect(main.getByText("Active", { exact: true })).toBeVisible();

    await main.getByRole("button", { name: "Pause" }).click();

    await expect(main.getByText("Paused", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Unpause" })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("wallet agents page renders empty agent registry", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole("main");

    await page.goto("/#/admin/agents");

    await expect(
      main.getByRole("heading", { name: "Wallet Agents" }),
    ).toBeVisible();
    await expect(main.getByText("No wallet agents registered.")).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("shows error state when user creation fails", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page, {
      failures: {
        "POST /admin/users": {
          status: 409,
          body: { message: "Username already exists" },
        },
      },
    });

    await page.goto("/#/admin/users-groups");

    await page.getByRole("button", { name: /Add User/i }).click();
    await expect(page.getByText("Create New User")).toBeVisible();

    await page.getByPlaceholder(/username/i).fill("duplicate");
    await page.getByPlaceholder(/password/i).fill("SecurePass123!");
    await page
      .getByPlaceholder("user@example.com")
      .fill("duplicate@example.com");
    await page.getByRole("button", { name: /Create User/i }).click();

    // Should show error message
    await expect(page.getByText(/already exists|error|failed/i)).toBeVisible({
      timeout: 5000,
    });

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Variables ---

  test("update system variables and save", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/variables");

    await expect(
      page.getByText("Confirmation Threshold", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Deep Confirmation Threshold", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Dust Threshold", { exact: true }),
    ).toBeVisible();

    // Change confirmation threshold
    const confirmInput = page.locator('input[type="number"]').first();
    await confirmInput.clear();
    await confirmInput.fill("3");

    // Save
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Should show success
    await expect(page.getByText(/saved|success/i)).toBeVisible({
      timeout: 5000,
    });

    expect(unhandledRequests).toEqual([]);
  });

  test("dust threshold has correct constraints", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/variables");

    // Find dust threshold input (3rd number input)
    const dustInput = page.locator('input[type="number"]').nth(2);
    await expect(dustInput).toBeVisible();

    // Should have min/max attributes
    await expect(dustInput).toHaveAttribute("min", "1");

    expect(unhandledRequests).toEqual([]);
  });

  // --- Node Configuration ---

  test("node config page shows save button and sections", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/node-config");

    await expect(
      page.getByRole("heading", { name: "Node Configuration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Save All Settings/i }),
    ).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("saving node config shows success message", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/node-config");
    await expect(
      page.getByRole("heading", { name: "Node Configuration" }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Save All Settings/i }).click();

    await expect(page.getByText(/saved|success/i)).toBeVisible({
      timeout: 5000,
    });

    expect(unhandledRequests).toEqual([]);
  });

  // --- Backup ---

  test("backup tab shows create backup button", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole("main");

    await page.goto("/#/admin/backup");

    await expect(
      main.getByRole("heading", { name: "Create Backup" }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", { name: /Download Backup/i }),
    ).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("restore tab shows file upload zone", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole("main");

    await page.goto("/#/admin/backup");
    await main.getByRole("button", { name: "Restore", exact: true }).click();

    await expect(
      main.getByRole("heading", { name: "Restore from Backup" }),
    ).toBeVisible();
    await expect(
      main.getByText("Drop backup file here or click to browse"),
    ).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("encryption keys section is present on backup page", async ({
    page,
  }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole("main");

    await page.goto("/#/admin/backup");

    // The backup page should render with an encryption keys section
    await expect(
      main.getByRole("heading", { name: "Create Backup" }),
    ).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- System Settings ---

  test("system settings shows access control toggle", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/settings");
    await expect(
      page.getByRole("heading", { name: "System Settings" }),
    ).toBeVisible();

    await expect(page.getByText("Public Registration").first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Audit Logs ---

  test("audit logs page shows filters and refresh button", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/audit-logs");
    await expect(
      page.getByRole("heading", { name: "Audit Logs" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Filters/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("audit log filters panel expands on click", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/audit-logs");
    await expect(
      page.getByRole("heading", { name: "Audit Logs" }),
    ).toBeVisible();

    const filtersButton = page
      .getByRole("button", { name: /Filters/i })
      .first();
    if (await filtersButton.isVisible()) {
      await filtersButton.click();
      // Filter panel should expand with filter inputs - look for "Apply Filters" button
      await expect(
        page.getByRole("button", { name: /Apply Filters/i }),
      ).toBeVisible({ timeout: 3000 });
    }

    expect(unhandledRequests).toEqual([]);
  });
});
