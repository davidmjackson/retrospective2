const { test, expect } = require("@playwright/test");
const { seedSession } = require("./helpers/seed");
const { injectSession } = require("./helpers/_auth");

test("unauthenticated /lobby redirects to the hub", async ({ request }) => {
  const res = await request.get("/lobby", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"] || "").toContain("127.0.0.1:9");
});

test("a user cannot read a board owned by another company", async ({ playwright, baseURL }) => {
  seedSession({ id: "sessA", userId: "uA", company: { id: "coA", name: "A Ltd" } });
  const ctxA = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=sessA" }
  });
  const created = await ctxA.post("/api/retros", { data: { title: "A Board" } });
  expect(created.status()).toBe(201);
  const { retro } = await created.json();
  expect(retro.shareToken).toBeTruthy();

  seedSession({ id: "sessB", userId: "uB", company: { id: "coB", name: "B Ltd" } });
  const ctxB = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=sessB" }
  });
  const forbidden = await ctxB.get(`/api/retros/${retro.id}`);
  expect(forbidden.status()).toBe(404);

  const own = await ctxB.post("/api/retros", { data: { title: "B Board" } });
  expect(own.status()).toBe(201);
  await ctxA.dispose();
  await ctxB.dispose();
});

test("authed user sees their company and can open a board", async ({ page, context }) => {
  seedSession();
  await injectSession(context);
  await page.goto("/lobby");
  await expect(page.locator("#company-name")).toHaveText("Acme");
  await expect(page.locator("#team-select")).toHaveCount(0);
  await page.fill("#display-name", "Tester");
  await page.fill("#create-title", "Sprint 1");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/retrospective\?retroId=/, { timeout: 10000 });
  await expect(page.locator("#col-well")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#copy-invite-link")).toBeVisible();
});
