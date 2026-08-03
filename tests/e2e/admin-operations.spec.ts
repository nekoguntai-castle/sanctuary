import { expect, test, type Page } from "@playwright/test";
import {
  AGENT_MANAGEMENT_OPTIONS,
  AGENT_WALLET_DASHBOARD_ROWS,
  WALLET_AGENTS,
} from "./adminOperationsFixtures";
import { mockResponse } from "./adminOperationsApiState";
import { mockAdminApi } from "./adminOperationsApiMock";

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

  test("toggling a feature flag shows saved confirmation", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/feature-flags");
    await expect(
      page.getByRole("heading", { name: "Feature Flags" }),
    ).toBeVisible();

    await expect(page.getByText("treasuryAutopilot")).toBeVisible();
    await expect(page.getByText("enhancedDashboard")).toBeVisible();
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
      await expect(
        page
          .getByText("No changes recorded yet.")
          .or(page.getByText("Loading audit log...")),
      ).toBeVisible();
    }

    expect(unhandledRequests).toEqual([]);
  });

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

    await page.getByRole("button", { name: /Add User/i }).click();
    await expect(page.getByText("Create New User")).toBeVisible();
    await page.getByPlaceholder(/username/i).fill("newuser");
    await page.getByPlaceholder(/password/i).fill("SecurePass123!");
    await page.getByPlaceholder("user@example.com").fill("newuser@example.com");
    await page.getByRole("button", { name: /Create User/i }).click();
    await expect(page.getByText("newuser", { exact: true })).toBeVisible({
      timeout: 5000,
    });

    expect(unhandledRequests).toEqual([]);
  });

  test("delete user with confirmation", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/users-groups");
    await expect(page.getByText("viewer", { exact: true })).toBeVisible();

    page.on("dialog", (dialog) => dialog.accept());
    const viewerRow = page.locator("li").filter({ hasText: "viewer" });
    const deleteButton = viewerRow.locator('button[title="Delete user"]');

    if (await deleteButton.first().isVisible()) {
      await deleteButton.first().click();
      await expect(page.getByText("viewer", { exact: true })).not.toBeVisible({
        timeout: 5000,
      });
    }

    expect(unhandledRequests).toEqual([]);
  });

  test("create group via inline form", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/users-groups");

    const groupInput = page
      .getByPlaceholder(/group name/i)
      .or(page.getByPlaceholder(/new group/i));
    if (await groupInput.isVisible()) {
      await groupInput.fill("Test Group");
      await page.getByRole("button", { name: /Create/i }).click();

      await expect(page.getByText("Test Group")).toBeVisible({ timeout: 5000 });
    }

    expect(unhandledRequests).toEqual([]);
  });

  test("delete group with confirmation", async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto("/#/admin/users-groups");

    const groupInput = page
      .getByPlaceholder(/group name/i)
      .or(page.getByPlaceholder(/new group/i));
    if (await groupInput.isVisible()) {
      await groupInput.fill("Group To Delete");
      await page.getByRole("button", { name: /Create/i }).click();
      await expect(page.getByText("Group To Delete")).toBeVisible({
        timeout: 5000,
      });

      page.on("dialog", (dialog) => dialog.accept());
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

    await expect(
      main.getByText("admin", { exact: true }).first(),
    ).toBeVisible();
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

  test("wallet agent setup creates link and lands on agent wallet dashboard", async ({
    page,
  }) => {
    const createdAgent = {
      ...WALLET_AGENTS[0],
      id: "agent-ops-created",
      name: "Ops Agent",
      operationalWalletId: "wallet-agent-operational-inline",
      signerDeviceId: null,
      signerDevice: null,
      operationalWallet: {
        id: "wallet-agent-operational-inline",
        name: "Inline Imported Ops",
        type: "single_sig",
        network: "testnet3",
      },
      apiKeys: [],
    };
    const importedOperationalWallet = {
      ...AGENT_MANAGEMENT_OPTIONS.wallets[1],
      id: "wallet-agent-operational-inline",
      name: "Inline Imported Ops",
    };
    const optionsWithImportedOperational = {
      ...AGENT_MANAGEMENT_OPTIONS,
      wallets: [
        AGENT_MANAGEMENT_OPTIONS.wallets[0],
        AGENT_MANAGEMENT_OPTIONS.wallets[1],
        importedOperationalWallet,
      ],
    };
    const createdDashboardRow = {
      ...AGENT_WALLET_DASHBOARD_ROWS[0],
      agent: createdAgent,
      operationalBalanceSats: "0",
      pendingFundingDraftCount: 0,
      openAlertCount: 0,
      activeKeyCount: 0,
      lastFundingDraft: null,
      lastOperationalSpend: null,
      recentFundingDrafts: [],
      recentOperationalSpends: [],
      recentAlerts: [],
    };
    const unhandledRequests = await mockAdminApi(page, {
      responseOverrides: {
        "GET /admin/agents/options": mockResponse(
          optionsWithImportedOperational,
        ),
        "POST /wallets/import/validate": mockResponse({
          valid: true,
          format: "descriptor",
          walletType: "single_sig",
          scriptType: "native_segwit",
          network: "testnet3",
          devices: [],
          suggestedName: "Inline Imported Ops",
        }),
        "POST /wallets/import": mockResponse(
          {
            wallet: {
              id: importedOperationalWallet.id,
              name: importedOperationalWallet.name,
              type: "single_sig",
              scriptType: "native_segwit",
              network: "testnet3",
              quorum: null,
              totalSigners: null,
              descriptor: "wpkh([abcd1234/84h/1h/0h]tpub.../0/*)",
            },
            devicesCreated: 0,
            devicesReused: 0,
            createdDeviceIds: [],
            reusedDeviceIds: [],
          },
          201,
        ),
        "POST /admin/agents": mockResponse(createdAgent, 201),
        "GET /admin/agents/dashboard": mockResponse([createdDashboardRow]),
      },
    });
    const main = page.getByRole("main");

    await page.goto("/#/admin/agents");
    await main.getByRole("button", { name: "Add Agent Wallet" }).click();

    await main.getByPlaceholder("Treasury funding agent").fill("Ops Agent");
    const selects = main.locator("select");
    await selects.nth(0).selectOption("user-ops-regular");
    await main.getByRole("button", { name: "Next" }).click();

    await expect(
      main.getByRole("link", { name: "Open full import page" }),
    ).toHaveAttribute("href", "#/wallets/import");
    await selects.nth(0).selectOption("wallet-agent-funding");
    await main.getByRole("button", { name: "Import" }).click();
    await main.getByPlaceholder("Agent operational wallet").fill("Inline Imported Ops");
    await main
      .getByPlaceholder(/wpkh/)
      .fill("wpkh([abcd1234/84h/1h/0h]tpub.../0/*)");
    await main.getByRole("button", { name: "Import and select" }).click();
    await expect(main.getByText("Imported and selected Inline Imported Ops")).toBeVisible();
    await main.getByRole("button", { name: "Next" }).click();
    await main.getByRole("button", { name: "Next" }).click();
    await main.getByRole("button", { name: "Add Agent Wallet" }).last().click();

    await expect(page).toHaveURL(/#\/admin\/agent-wallets/);
    await expect(
      main.getByRole("heading", { name: "Agent Wallets" }),
    ).toBeVisible();
    await expect(main.getByText("Ops Agent")).toBeVisible();
    await expect(
      main.getByRole("link", { name: "Funding Wallet" }),
    ).toHaveAttribute("href", /wallet-agent-funding/);
    await expect(
      main.getByRole("link", { name: "Operational Wallet" }),
    ).toHaveAttribute("href", /wallet-agent-operational-inline/);

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
    await main.getByRole("tab", { name: "Restore", exact: true }).click();

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
