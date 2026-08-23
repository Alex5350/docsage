import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  DEMO_PASSWORD,
  RILEY_EMAIL,
  loginViaUi,
  registerViaUi,
  uniqueEmail,
} from "../helpers/stack";

/** Backend origin pinned by playwright.config.ts (the app's API base in runs). */
const API_ORIGIN = "http://localhost:8100";

test.describe("admin topics", () => {
  test("admin creates a topic, designates and removes an SME by user id", async ({ browser }) => {
    // Register a fresh member to designate. The v1 API has no user directory,
    // so her id is read straight from /auth/me in her own signed-in page —
    // exactly the flow the picker's help copy tells admins to use.
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const displayName = "Grant Checker";
    await registerViaUi(memberPage, uniqueEmail("sme"), DEMO_PASSWORD, displayName);
    const me = await memberPage.evaluate(async (origin) => {
      const response = await fetch(`${origin}/api/auth/me`, { credentials: "include" });
      if (!response.ok) throw new Error(`/api/auth/me failed: ${response.status}`);
      return (await response.json()) as { id: string };
    }, API_ORIGIN);
    await memberContext.close();

    const adminContext = await browser.newContext();
    const page = await adminContext.newPage();
    await loginViaUi(page, ADMIN_EMAIL, DEMO_PASSWORD);
    await page.goto("/admin/topics");

    await expect(page.getByRole("heading", { name: "Topics & SMEs" })).toBeVisible();
    // Seeded topics prove the list is wired to GET /api/topics.
    await expect(page.getByText("Workplace Policy", { exact: true })).toBeVisible();

    // Create a topic with a collision-proof name.
    const topicName = `Grant Compliance ${Date.now()}`;
    await page.getByRole("button", { name: "New topic" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New topic" })).toBeVisible();
    await dialog.getByRole("textbox", { name: /name/i }).fill(topicName);
    await dialog.getByRole("textbox", { name: "Description" }).fill("Grants and compliance filings.");
    await dialog.getByRole("button", { name: "Create topic" }).click();
    await expect(dialog).toBeHidden();

    // The new card renders (direct <li> child of the topics list — toasts also
    // contain the topic name, but they live in a different portal).
    const card = page
      .locator('ul[aria-label="Topics"] > li')
      .filter({ hasText: topicName });
    await expect(card).toBeVisible();
    await expect(card.getByText("No SMEs yet")).toBeVisible();

    await card.getByRole("button", { name: "Add SME" }).click();
    const smeDialog = page.getByRole("dialog");
    await expect(smeDialog.getByRole("heading", { name: "Add SME" })).toBeVisible();

    // v1 resolves user ids only: pasting an email surfaces the guidance error.
    await smeDialog.getByRole("textbox", { name: "Member id or email" }).fill("morgan@docsage.dev");
    await smeDialog.getByRole("button", { name: "Designate SME" }).click();
    await expect(smeDialog.getByRole("alert")).toContainText("Enter the user's id");

    // The real id designates the SME: the chip appears on the card.
    await smeDialog.getByRole("textbox", { name: "Member id or email" }).fill(me.id);
    await smeDialog.getByRole("button", { name: "Designate SME" }).click();
    await expect(smeDialog).toBeHidden();
    await expect(card.getByText(displayName, { exact: true })).toBeVisible();

    // Removing the designation takes the chip away again.
    await card.getByRole("button", { name: `Remove ${displayName} from ${topicName}` }).click();
    await expect(card.getByText(displayName, { exact: true })).toHaveCount(0);
    await expect(card.getByText("No SMEs yet")).toBeVisible();
    await adminContext.close();
  });

  test("non-admins get no Topics nav entry and a restricted panel on /admin/topics", async ({
    page,
  }) => {
    await loginViaUi(page, RILEY_EMAIL, DEMO_PASSWORD);

    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Topics" })).toHaveCount(0);

    await page.goto("/admin/topics");
    await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Topics & SMEs" })).toHaveCount(0);
  });
});
