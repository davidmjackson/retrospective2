const { test, expect } = require("@playwright/test");
const { seedSession } = require("./helpers/seed");
const { injectSession } = require("./helpers/_auth");

test("unauthenticated /lobby redirects to the hub", async ({ request }) => {
  const res = await request.get("/lobby", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"] || "").toContain("127.0.0.1:9");
});

test("a user cannot read a board owned by a team they are not in", async ({ playwright, baseURL }) => {
  // Session A is a member of t1 AND t2; it creates a board owned by t2.
  seedSession({
    id: "sessA",
    userId: "uA",
    teams: [
      { id: "t1", name: "Alpha", role: "lead" },
      { id: "t2", name: "Beta", role: "member" }
    ]
  });
  const ctxA = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=sessA" }
  });
  const created = await ctxA.post("/api/retros", {
    data: { title: "Beta Board", teamId: "t2" }
  });
  expect(created.status()).toBe(201);
  const { retro } = await created.json();

  // Session B is a member of t1 ONLY; it must NOT be able to read the t2 board.
  seedSession({
    id: "sessB",
    userId: "uB",
    teams: [{ id: "t1", name: "Alpha", role: "lead" }]
  });
  const ctxB = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=sessB" }
  });
  const forbidden = await ctxB.get(`/api/retros/${retro.id}`);
  expect(forbidden.status()).toBe(404);
  // And B can create + read its OWN team's board.
  const own = await ctxB.post("/api/retros", { data: { title: "Alpha Board", teamId: "t1" } });
  expect(own.status()).toBe(201);
  await ctxA.dispose();
  await ctxB.dispose();
});

test("authed user sees their team and can open a board", async ({ page, context }) => {
  seedSession();
  await injectSession(context);
  await page.goto("/lobby");
  await expect(page.locator("#team-select option")).toHaveCount(1);
  await page.fill("#display-name", "Tester");
  await page.fill("#create-title", "Sprint 1");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/retrospective\?retroId=/, { timeout: 10000 });
  await expect(page.locator("#col-well")).toBeVisible({ timeout: 10000 });
});
