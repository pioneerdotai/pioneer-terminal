import type { Page } from "@playwright/test";

export async function openOutput(page: Page) {
  await page
    .getByRole("button", { name: "Terminal actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Read output", exact: true }).click();
}
