import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { DEMO_PASSWORD, fixture, registerViaUi, uniqueEmail, uploadAndWaitReady } from "../helpers/stack";

/**
 * The multi-format ingestion centerpiece: every supported fixture format goes
 * through the real upload UI, reaches Ready with at least one indexed chunk,
 * and shows up in the Documents list. One fresh user uploads all eight files
 * so the Documents assertions never depend on other specs' data.
 */

interface FormatCase {
  /** Fixture file under e2e/fixtures/. */
  file: string;
  /** Default title the UI derives from the filename. */
  title: string;
}

const FORMATS: FormatCase[] = [
  { file: "volunteer-handbook.docx", title: "volunteer handbook" },
  { file: "grants-tracking.xlsx", title: "grants tracking" },
  { file: "shelter-inspection.pdf", title: "shelter inspection" },
  { file: "org-chart.png", title: "org chart" },
  { file: "site-photo.jpg", title: "site photo" },
  { file: "drill-incident-log.txt", title: "drill incident log" },
  { file: "press-release.md", title: "press release" },
  { file: "volunteer-roster.csv", title: "volunteer roster" },
];

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await registerViaUi(page, uniqueEmail("formats"), DEMO_PASSWORD, "Format Checker");
});

test.afterAll(async () => {
  await context.close();
});

test.describe("multi-format upload", () => {
  // Playwright's parameterization idiom: one generated test per format.
  for (const { file, title } of FORMATS) {
    test(`${file} reaches Ready and appears in Documents`, async () => {
      const status = await uploadAndWaitReady(page, file);
      expect(status).toMatch(/Ready — \d+ chunks? indexed/);

      await page.goto("/documents");
      const card = page.getByRole("button", { name: `Open details for ${title}` });
      await expect(card).toBeVisible();
      await expect(card).toContainText("Ready");
    });
  }

  test("volunteer-handbook.docx detail dialog shows enrichment artifacts", async () => {
    await page.goto("/documents");
    await page.getByRole("button", { name: "Open details for volunteer handbook" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("volunteer-handbook.docx");

    const enrichments = dialog.locator('section[aria-label="Enrichments"]');
    await expect(enrichments).toBeVisible();

    // Summary: heading plus a non-empty paragraph.
    await expect(enrichments.getByRole("heading", { name: "Summary" })).toBeVisible();
    const summary = enrichments.locator("p").filter({ hasText: /\S/ });
    await expect(summary.first()).toBeVisible();

    // Keywords: at least one chip.
    await expect(enrichments.getByRole("heading", { name: "Keywords" })).toBeVisible();
    const keywords = enrichments.locator('ul[aria-label="Keywords"] > li');
    await expect(keywords.first()).toBeVisible();

    // Likely questions: at least one suggested question.
    await expect(enrichments.getByRole("heading", { name: "Likely questions" })).toBeVisible();
    const questions = enrichments.locator('ul[aria-label="Likely questions"] > li');
    await expect(questions.first()).toBeVisible();
  });

  test("unsupported .zip is rejected client-side and cannot be uploaded", async () => {
    await page.goto("/upload");
    await page.locator('input[type="file"]').setInputFiles(fixture("invalid-payload.zip"));

    await expect(page.locator('p[role="alert"]')).toContainText("Unsupported type");
    await expect(page.locator('p[role="alert"]')).toContainText("PDF, DOCX, XLSX, PNG, JPG, TXT, MD, CSV");

    // The invalid file never becomes uploadable: the action shows "Upload 0
    // files" and is disabled, and no pipeline card is created.
    const uploadButton = page.getByRole("button", { name: /upload \d+ files?/i });
    await expect(uploadButton).toBeDisabled();
    await expect(uploadButton).toHaveText(/upload 0 files/i);
    await expect(page.getByRole("region", { name: "Ingestion pipeline" })).toHaveCount(0);
  });

  test("a 28MB file trips the 25MB client guard with a clear message", async () => {
    await page.goto("/upload");
    await page.locator('input[type="file"]').setInputFiles(fixture("oversized-blob.txt"));

    await expect(page.locator('p[role="alert"]')).toContainText("Too large");
    await expect(page.locator('p[role="alert"]')).toContainText("the limit is 25 MB");

    const uploadButton = page.getByRole("button", { name: /upload \d+ files?/i });
    await expect(uploadButton).toBeDisabled();
    await expect(page.getByRole("region", { name: "Ingestion pipeline" })).toHaveCount(0);
  });

  test("provider cards: key-less providers disabled, Demo deterministic selected", async () => {
    await page.goto("/upload");
    await page.locator('input[type="file"]').setInputFiles(fixture("org-chart.png"));

    const group = page.getByRole("radiogroup", { name: "Embedding provider" });
    await expect(group).toBeVisible();

    await expect(group.getByRole("radio", { name: "Gemini Embedding 2" })).toBeDisabled();
    await expect(group.getByRole("radio", { name: "OpenAI text-embedding-3-small" })).toBeDisabled();
    await expect(group.getByRole("radio", { name: "Demo deterministic" })).toBeChecked();

    // Both real providers explain why they are off.
    await expect(group.getByText("requires API key")).toHaveCount(2);
  });
});
