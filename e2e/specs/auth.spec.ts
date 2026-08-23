import { expect, test } from "@playwright/test";
import {
  DEMO_PASSWORD,
  RILEY_EMAIL,
  loginViaUi,
  registerViaUi,
  signOutViaUi,
  uniqueEmail,
} from "../helpers/stack";

test.describe("authentication", () => {
  test("registering a new account lands on /chat with the welcome state", async ({ page }) => {
    const email = uniqueEmail("auth");
    await registerViaUi(page, email, DEMO_PASSWORD, "Auth Checker");

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("region", { name: "Conversation" })).toBeVisible();
    // Greeting for a brand-new account: the welcome hero + suggested prompts.
    await expect(page.getByRole("heading", { name: "Ask your documents anything" })).toBeVisible();
    await expect(page.getByRole("button", { name: /summarize the key points/i })).toBeVisible();
  });

  test("registering an email that already exists shows an error and stays on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("tab", { name: "Register" }).click();
    await page.getByRole("textbox", { name: "Display name" }).fill("Imposter");
    await page.getByRole("textbox", { name: "Email" }).fill(RILEY_EMAIL);
    await page.getByRole("textbox", { name: "Password" }).fill("another-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator('p[role="alert"]')).toContainText("Email already registered");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signing in with a wrong password shows an error", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill(RILEY_EMAIL);
    await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator('p[role="alert"]')).toContainText("Invalid credentials");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("after sign-out, guarded routes redirect to /login", async ({ page }) => {
    await loginViaUi(page, RILEY_EMAIL, DEMO_PASSWORD);
    await signOutViaUi(page);

    await page.goto("/documents");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  });

  test("unauthenticated visits to app routes redirect to /login", async ({ page }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login$/);
  });
});
