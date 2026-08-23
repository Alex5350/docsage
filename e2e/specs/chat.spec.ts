import { expect, test } from "@playwright/test";
import {
  DEMO_PASSWORD,
  RILEY_EMAIL,
  SEEDED_LIBRARY_TITLES,
  askAndWait,
  loginViaUi,
  registerViaUi,
  startConversation,
  uniqueEmail,
  uploadAndWaitReady,
} from "../helpers/stack";

test.describe("chat", () => {
  test("seeded conversation loads its transcript — including when re-selected", async ({ page }) => {
    await loginViaUi(page, RILEY_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/chat$/);

    const sessionButton = page.getByRole("button", { name: /Telework question/i });
    await expect(sessionButton).toBeVisible();
    await sessionButton.click();

    const log = page.getByRole("log", { name: "Messages" });
    await expect(log).toContainText("How many remote days are allowed per week?");
    const citations = log.locator('[aria-label^="Citation"]');
    await expect(citations.first()).toBeVisible();
    const citationCount = await citations.count();
    expect(citationCount).toBeGreaterThan(0);

    // REGRESSION: re-selecting the already-active conversation must re-render
    // the transcript (it used to blank out). Select it a second time...
    await sessionButton.click();
    // ...and the transcript (question, answer, citations) must still be there.
    await expect(log).toContainText("How many remote days are allowed per week?");
    await expect(log.locator('[aria-label^="Citation"]').first()).toBeVisible();
    await expect
      .poll(() => log.locator('[aria-label^="Citation"]').count(), { timeout: 10_000 })
      .toBe(citationCount);
  });

  test("a freshly uploaded press release is cited when asking about its content", async ({
    page,
  }) => {
    await registerViaUi(page, uniqueEmail("chat"), DEMO_PASSWORD, "Chat Checker");
    await uploadAndWaitReady(page, "press-release.md");

    await page.goto("/chat");
    await startConversation(page);
    // Demo retrieval ranks by deterministic hash vectors, so the exact
    // wording matters: this question ranks the press release #2 for a user
    // whose corpus is the press release + the four seeded library documents
    // (verified through the backend's own retrieve() against the exact
    // candidate set this spec produces).
    const { answerText, citations } = await askAndWait(
      page,
      "code COOL-26 paratransit cooling center",
    );

    // Demo answers are extractive: the top excerpt is the press release itself.
    expect(answerText).toMatch(/cooling center/i);
    const cited = citations.some((label) => /press release/i.test(label));
    expect(cited, `citations should include the press release: ${citations.join(" | ")}`).toBe(true);
  });

  test("REGRESSION: sending the first message immediately after creating a conversation keeps the answer", async ({
    page,
  }) => {
    await registerViaUi(page, uniqueEmail("race"), DEMO_PASSWORD, "Race Checker");
    await uploadAndWaitReady(page, "press-release.md");

    await page.goto("/chat");
    // Create the conversation and send WITHOUT waiting for the transcript
    // fetch to settle — a late response used to wipe the optimistic user
    // message and the streamed answer from the transcript.
    await page.getByRole("button", { name: "New conversation" }).click();
    const composer = page.getByRole("textbox", { name: "Ask a question about your documents" });
    await composer.fill("cooling center hours");
    await composer.press("Enter");

    const log = page.getByRole("log", { name: "Messages" });
    await expect(log).toContainText("cooling center hours");
    // The stream completes and its answer stays in the transcript.
    await expect
      .poll(async () => log.locator('[aria-label^="Citation"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(750); // let any late transcript fetch land
    await expect(log).toContainText("cooling center hours");
    await expect(log.locator('[aria-label^="Citation"]').first()).toBeVisible();
  });

  test("a brand-new user sees the welcome state with suggested questions", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("fresh"), DEMO_PASSWORD, "Fresh Checker");

    await expect(page.getByRole("heading", { name: "Ask your documents anything" })).toBeVisible();
    await expect(page.getByText("Answers are grounded in your documents only")).toBeVisible();
    await expect(page.getByRole("button", { name: /summarize the key points/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /compliance requirements/i })).toBeVisible();
    await expect(page.getByText("Personal scope")).toBeVisible();
  });

  test("personal documents are isolated: another user's uploads are never cited", async ({
    browser,
  }) => {
    // User A uploads a distinctive document to their personal workspace.
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await registerViaUi(pageA, uniqueEmail("iso-a"), DEMO_PASSWORD, "Isolation A");
    const status = await uploadAndWaitReady(pageA, "drill-incident-log.txt", {
      title: "Elm Creek drill incident log",
    });
    expect(status).toMatch(/Ready — \d+ chunks? indexed/);
    await contextA.close();

    // User B (fresh) asks about exactly that subject.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await registerViaUi(pageB, uniqueEmail("iso-b"), DEMO_PASSWORD, "Isolation B");
    await pageB.goto("/chat");
    await startConversation(pageB);
    const { citations } = await askAndWait(pageB, "What happened at the Elm Creek drill on June 11?");

    // Retrieval must be scoped to B's visible corpus: B's own documents (none)
    // plus the approved agency library. A's upload can never appear.
    expect(citations.length, "demo retrieval always cites its top-k passages").toBeGreaterThan(0);
    for (const label of citations) {
      const allowed = SEEDED_LIBRARY_TITLES.some((title) => label.includes(title));
      expect(allowed, `citation must refer to a B-visible document: ${label}`).toBe(true);
    }
    expect(
      citations.some((label) => /drill/i.test(label)),
      `A's personal document leaked into B's citations: ${citations.join(" | ")}`,
    ).toBe(false);
    await contextB.close();
  });
});
