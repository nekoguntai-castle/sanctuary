import { expect, test } from "@playwright/test";

import { mockAuthenticatedApi } from "./render-regression/renderRegressionHarness";

test("network sync switch avoids white surfaces in dark mode", async ({
  page,
}) => {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto("/#/admin/node-config");
  await expect(
    page.getByRole("heading", { name: "Node Configuration" }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });

  await page.getByRole("button", { name: /Network Connections/i }).click();
  await page.getByRole("button", { name: /^testnet/i }).click();

  const switchControl = page.getByRole("switch", { name: "Testnet Sync" });
  await expect(switchControl).toBeVisible();

  const colors = await switchControl.evaluate((element) => {
    const thumb = element.querySelector("span");
    const row = element.closest(".surface-secondary");

    return {
      row: row ? getComputedStyle(row).backgroundColor : "",
      thumb: thumb ? getComputedStyle(thumb).backgroundColor : "",
      track: getComputedStyle(element).backgroundColor,
    };
  });

  expect(colors.row).not.toBe("rgb(255, 255, 255)");
  expect(colors.thumb).not.toBe("rgb(255, 255, 255)");
  expect(colors.track).not.toBe("rgb(255, 255, 255)");
  expect(unhandledRequests).toEqual([]);
});
