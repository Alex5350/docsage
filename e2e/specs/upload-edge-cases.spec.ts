import { expect, test } from "@playwright/test";
import {
  DEMO_PASSWORD,
  RILEY_EMAIL,
  fixture,
  loginViaUi,
  registerViaUi,
  uniqueEmail,
} from "../helpers/stack";

test.describe("upload + streaming edge cases", () => {
  test("multiple files in one batch upload all reach Ready", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("batch"), DEMO_PASSWORD, "Batch Uploader");
    await page.goto("/upload");

    const input = page.locator('input[type="file"]');
    await input.setInputFiles([fixture("drill-incident-log.txt"), fixture("volunteer-roster.csv")]);

    // Both files appear as pending configs, sharing one Upload button ("2 files").
    await expect(page.getByText("drill-incident-log.txt")).toBeVisible();
    await expect(page.getByText("volunteer-roster.csv")).toBeVisible();
    await page.getByRole("button", { name: /upload 2 files/i }).click();

    await expect(
      page.getByRole("status").filter({ hasText: /chunks? indexed/ }),
    ).toHaveCount(2, { timeout: 30_000 });

    await page.goto("/documents");
    await expect(page.getByText("drill incident log")).toBeVisible();
    await expect(page.getByText("volunteer roster")).toBeVisible();
  });

  test("stop generating keeps the partial answer and frees the composer", async ({ page }) => {
    await loginViaUi(page, RILEY_EMAIL, DEMO_PASSWORD);
    await page.goto("/chat");

    // The seeded corpus streams a multi-paragraph demo answer; stop it early.
    await page.getByRole("button", { name: "New conversation" }).click();
    const composer = page.getByRole("textbox", { name: "Ask a question about your documents" });
    await composer.fill("What are the technical requirements for telework and remote access?");
    await composer.press("Enter");

    const stop = page.getByRole("button", { name: "Stop generating" });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(stop).toBeHidden();

    // Whatever streamed before the stop stays visible, and the composer works again.
    const log = page.getByRole("log", { name: "Messages" });
    await expect(log).toContainText("technical requirements", { ignoreCase: true });
    await composer.fill("thank you");
    await composer.press("Enter");
    await expect(log).toContainText("thank you");
  });
});
