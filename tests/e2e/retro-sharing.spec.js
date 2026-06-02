const { test, expect } = require("@playwright/test");
const { seedSession } = require("./helpers/seed");

async function createBoard(playwright, baseURL) {
  seedSession();
  const ctx = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=s-e2e" }
  });
  const res = await ctx.post("/api/retros", { data: { title: "Shared Retro" } });
  expect(res.status()).toBe(201);
  const { retro } = await res.json();
  await ctx.dispose();
  return retro;
}

test("anonymous join page validates the token and shows a name form", async ({ page, playwright, baseURL }) => {
  const retro = await createBoard(playwright, baseURL);
  await page.goto(`/join?token=${retro.shareToken}`);
  await expect(page.locator("#join-form")).toBeVisible();
  await expect(page.locator("#join-board-title")).toContainText("Shared Retro");
});

test("an invalid token shows a friendly error", async ({ page }) => {
  await page.goto("/join?token=does-not-exist");
  await expect(page.locator("#join-error")).toBeVisible();
});

test("anonymous participant joins, has no timer or create-action controls, can add a card and vote", async ({ page, playwright, baseURL }) => {
  const retro = await createBoard(playwright, baseURL);
  await page.goto(`/join?token=${retro.shareToken}`);
  await page.fill("#join-name", "Guest");
  await page.click("#join-form button[type=submit]");
  await page.waitForURL(/\/shared\?/, { timeout: 10000 });
  await expect(page.locator("#col-well")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("body.anon")).toHaveCount(1);
  // Facilitator timer controls must be genuinely hidden from anonymous joiners.
  await expect(page.locator(".timer-controls")).toBeHidden();
  await expect(page.locator(".create-action-btn")).toHaveCount(0);

  // Add a card via the note dialog
  await page.click(".column-add[data-column='well']");
  await expect(page.locator("#note-dialog")).toBeVisible({ timeout: 5000 });
  await page.fill("#note-text", "Test note from guest");
  await page.click("#note-save");
  // Wait for the card to appear in the column
  const cardLocator = page.locator("#col-well .card");
  await expect(cardLocator.first()).toBeVisible({ timeout: 10000 });

  // Vote on the card
  const voteBtn = page.locator("#col-well .vote-btn").first();
  const voteCount = page.locator("#col-well .vote-count").first();
  const initialVotes = await voteCount.textContent();
  await voteBtn.click();
  await expect(voteCount).not.toHaveText(initialVotes, { timeout: 5000 });

  // Now that a real card exists, prove the promote-to-action control is hidden
  // from the anonymous joiner (the control is rendered per-card but hidden by
  // the body.anon CSS rule). This is the genuine "anon cannot facilitate" check.
  await expect(page.locator("#col-well .create-action-btn")).toBeHidden();
});

test("a closed board rejects the share link", async ({ page, playwright, baseURL }) => {
  const retro = await createBoard(playwright, baseURL);
  const ctx = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=s-e2e" }
  });
  const closed = await ctx.post(`/api/retros/${retro.id}/close`);
  expect(closed.status()).toBe(200);
  await ctx.dispose();
  const meta = await page.request.get(`/api/shared/${retro.shareToken}`);
  expect(meta.status()).toBe(410);
  await page.goto(`/join?token=${retro.shareToken}`);
  await expect(page.locator("#join-error")).toContainText("ended");
});
