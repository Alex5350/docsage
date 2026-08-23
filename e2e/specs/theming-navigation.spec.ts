import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, RILEY_EMAIL, loginViaUi } from "../helpers/stack";

test.describe("landing, theming, and app chrome", () => {
  test("landing page hero renders and its CTA leads to /login", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: /distilled into answers you can verify/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "How it works" })).toBeVisible();

    const cta = page.getByRole("link", { name: /start chatting/i });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("theme toggle flips dark/light and persists across reload", async ({ page }) => {
    await page.goto("/login");
    const html = page.locator("html");
    const read = (): Promise<string> =>
      html.evaluate((el) => (el.classList.contains("light") ? "light" : "dark"));

    const initial = await read(); // defaultTheme is dark, but read, don't assume
    await page.getByRole("button", { name: "Toggle theme" }).click();

    const flipped = initial === "dark" ? "light" : "dark";
    await expect.poll(read, { message: "theme class should flip" }).toBe(flipped);

    // The choice is persisted in localStorage and survives a reload.
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(flipped);
    await page.reload();
    await expect.poll(read, { message: "theme should persist across reload" }).toBe(flipped);
  });

  test("demo banner is visible on app pages", async ({ page }) => {
    await loginViaUi(page, RILEY_EMAIL, DEMO_PASSWORD);
    const banner = page.getByText(/Demo mode — no provider keys configured/);
    await expect(banner).toBeVisible();

    await page.goto("/documents");
    await expect(banner).toBeVisible();
  });
});
