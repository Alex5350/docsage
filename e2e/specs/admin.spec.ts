import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  DEMO_PASSWORD,
  RILEY_EMAIL,
  askAndWait,
  loginViaUi,
  startConversation,
  uploadAndWaitReady,
} from "../helpers/stack";

test.describe("admin", () => {
  test("overview renders stat cards and the pipeline distribution", async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, DEMO_PASSWORD);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin overview" })).toBeVisible();

    // All four stat cards render a label (values themselves vary per run —
    // earlier specs mutate them — so only their presence is asserted).
    for (const label of ["Users", "Personal documents", "Library documents", "Pending reviews"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    // The seeded corpus guarantees a non-empty pipeline distribution bar and
    // its stage legend (accessible name enumerates every stage count).
    await expect(page.getByText("Pipeline distribution")).toBeVisible();
    await expect(page.getByRole("img", { name: /Queued: \d+/ })).toBeVisible();
    await expect(page.getByText("Provider configuration")).toBeVisible();
  });

  test("admin cross-search answers across every owner's documents", async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, DEMO_PASSWORD);

    // Upload the drill log personally first, so this test owns its data and
    // never depends on another spec's ordering.
    const status = await uploadAndWaitReady(page, "drill-incident-log.txt", {
      title: "Elm Creek drill incident log",
    });
    expect(status).toMatch(/Ready — \d+ chunks? indexed/);

    await page.goto("/chat");
    // startConversation settles the new session's empty transcript fetch
    // before we ask — sending instantly after session creation races that
    // fetch and can visually drop the streamed answer.
    await startConversation(page, "Admin cross-search");

    // The scope badge makes the blast radius explicit.
    await expect(page.getByText("Admin · all documents")).toBeVisible();

    // Demo retrieval ranks by deterministic hash vectors, so the wording is
    // chosen to rank the drill log #1 over the seeded corpus (verified
    // against the real pgvector ordering for exactly this candidate set).
    const { answerText, citations } = await askAndWait(
      page,
      "What happened at the simulated levee breach at marker 7?",
    );
    // The top excerpt is the drill log's opening entries.
    expect(answerText).toMatch(/elm creek flood drill/i);
    expect(
      citations.some((label) => label.includes("Elm Creek drill incident log")),
      `cross-search should cite the admin's copy of the drill log: ${citations.join(" | ")}`,
    ).toBe(true);
  });

  test("non-admins get no Admin nav entry and a restricted panel on /admin", async ({ page }) => {
    await loginViaUi(page, RILEY_EMAIL, DEMO_PASSWORD);

    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Upload" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Documents" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Reviews" })).toHaveCount(0);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin overview" })).toHaveCount(0);
  });
});
