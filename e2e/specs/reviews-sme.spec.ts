import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  DEMO_PASSWORD,
  MORGAN_EMAIL,
  RILEY_EMAIL,
  fixture,
  loginViaUi,
  openUpload,
} from "../helpers/stack";

/**
 * SME approval workflow, end to end: an admin submits a document to the
 * agency library under a topic, the topic's SME approves or rejects it with a
 * note, and regular users see (or never see) the result. Titles carry a
 * timestamp so re-runs can never collide.
 */

const TOPIC = "Workplace Policy";

/** Admin-side: upload a fixture to the library under TOPIC with a unique title. */
async function uploadLibraryDoc(page: Page, fileName: string, title: string): Promise<void> {
  await loginViaUi(page, ADMIN_EMAIL, DEMO_PASSWORD);
  await openUpload(page);
  await page.locator('input[type="file"]').setInputFiles(fixture(fileName));
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  // The scope radios are sr-only inputs inside labels; click the visible
  // label text instead of the 1px input.
  await page
    .getByRole("radiogroup", { name: "Scope" })
    .getByText("Agency library", { exact: true })
    .click();

  const topicBox = page.getByRole("combobox", { name: "Library topic" });
  await topicBox.click();
  await page.getByRole("option", { name: TOPIC }).click();

  // Selecting a topic reveals its designated reviewers and the approval note.
  await expect(page.getByText("Reviewers:")).toBeVisible();
  await expect(page.getByText("Morgan SME")).toBeVisible();
  await expect(page.getByText("Library documents require SME approval")).toBeVisible();

  await page.getByRole("button", { name: /upload \d+ files?/i }).click();
  const status = page.getByRole("status").filter({ hasText: /chunks? indexed/ });
  await expect(status).toBeVisible({ timeout: 20_000 });
  await expect(status).toContainText("awaiting SME approval");
}

/** SME-side: open /reviews and act on the pending card with `title`. */
async function decideAsSme(
  browser: Browser,
  title: string,
  decision: "Approve" | "Reject",
  note: string,
): Promise<void> {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  await loginViaUi(page, MORGAN_EMAIL, DEMO_PASSWORD);
  await page.goto("/reviews");

  const queue = page.getByRole("list", { name: "Pending reviews" });
  const card = queue.getByRole("listitem").filter({ hasText: title });
  await expect(card).toBeVisible({ timeout: 15_000 });

  await card.getByRole("button", { name: decision }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `${decision} document?` })).toBeVisible();
  await dialog.locator("#review-note").fill(note);
  await dialog.getByRole("button", { name: decision, exact: true }).click();

  // Optimistic removal is confirmed: the card leaves the queue.
  await expect(card).toHaveCount(0);
  await context.close();
}

/** Riley-side: check whether a title is listed under the Agency library tab. */
async function libraryHas(browser: Browser, title: string): Promise<boolean> {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  await loginViaUi(page, RILEY_EMAIL, DEMO_PASSWORD);
  await page.goto("/documents");
  await page.getByRole("tab", { name: "Agency library" }).click();

  // Wait for the list itself to load via a seeded, always-present document.
  await expect(
    page.getByRole("button", { name: "Open details for Telework and Remote Access Policy" }),
  ).toBeVisible();

  const target = page.getByRole("button", { name: `Open details for ${title}` });
  const present = (await target.count()) > 0;
  await context.close();
  return present;
}

test.describe("SME review workflow", () => {
  test("an approved library document becomes visible agency-wide", async ({ browser }) => {
    const title = `Cooling centers press release ${Date.now()}`;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await uploadLibraryDoc(adminPage, "press-release.md", title);
    await adminContext.close();

    await decideAsSme(browser, title, "Approve", "Verified against the press office copy.");

    expect(await libraryHas(browser, title), "approved document should be agency-visible").toBe(true);
  });

  test("a rejected library document stays hidden from members (note required)", async ({
    browser,
  }) => {
    const title = `Drill incident log ${Date.now()}`;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await uploadLibraryDoc(adminPage, "drill-incident-log.txt", title);
    await adminContext.close();

    // SME opens the reject dialog and must supply a note before it submits.
    const context: BrowserContext = await browser.newContext();
    const sme = await context.newPage();
    await loginViaUi(sme, MORGAN_EMAIL, DEMO_PASSWORD);
    await sme.goto("/reviews");
    const queue = sme.getByRole("list", { name: "Pending reviews" });
    const card = queue.getByRole("listitem").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole("button", { name: "Reject" }).click();
    const dialog = sme.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Reject document?" })).toBeVisible();
    await expect(dialog.getByText("(required)")).toBeVisible();

    // With an empty note the confirm button is disabled and the form explains.
    const confirm = dialog.getByRole("button", { name: "Reject", exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.locator("#review-note").fill("Fixture log — not an agency policy document.");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(card).toHaveCount(0);
    await context.close();

    expect(
      await libraryHas(browser, title),
      "rejected document must not be listed for members",
    ).toBe(false);
  });
});
