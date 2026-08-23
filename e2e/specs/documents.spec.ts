import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, registerViaUi, uniqueEmail, uploadAndWaitReady } from "../helpers/stack";

test.describe("documents workspace", () => {
  const pressTitle = "QA docs press release";
  const photoTitle = "QA docs site photo";

  test("uploaded documents are listed, inspectable, and deletable", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("docs"), DEMO_PASSWORD, "Docs Checker");
    await uploadAndWaitReady(page, "press-release.md", { title: pressTitle });
    await uploadAndWaitReady(page, "site-photo.jpg", { title: photoTitle });

    // Both documents appear in the personal workspace with Ready status.
    await page.goto("/documents");
    const pressCard = page.getByRole("button", { name: `Open details for ${pressTitle}` });
    const photoCard = page.getByRole("button", { name: `Open details for ${photoTitle}` });
    await expect(pressCard).toBeVisible();
    await expect(photoCard).toBeVisible();
    await expect(pressCard).toContainText("Ready");
    await expect(photoCard).toContainText("Ready");

    // Detail dialog exposes the embedding provenance (demo provider + model).
    await pressCard.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(pressTitle);
    await expect(dialog.locator('[aria-label="Demo deterministic embeddings"]')).toBeVisible();
    await expect(dialog.getByText("demo-v1")).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Summary" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Delete the photo through the confirm flow; it disappears and stays gone.
    await photoCard.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(`Delete “${photoTitle}”?`);
    await page.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(photoCard).toHaveCount(0);
    await expect(pressCard).toBeVisible();

    // Reload: the deletion persisted server-side.
    await page.reload();
    await expect(pressCard).toBeVisible();
    await expect(photoCard).toHaveCount(0);
  });
});
