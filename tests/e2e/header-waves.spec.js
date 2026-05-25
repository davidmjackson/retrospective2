const { test, expect } = require("@playwright/test");

async function createTeamViaAdmin(page, team) {
  const adminLogin = await page.request.post("/api/login", {
    data: { name: "Waves Admin", role: "admin", team: "Admin", key: "admn1" }
  });
  expect(adminLogin.ok()).toBeTruthy();
  const teamCreate = await page.request.post("/api/teams", { data: { team } });
  expect(teamCreate.status()).toBe(201);
  const data = await teamCreate.json();
  await page.request.post("/api/logout");
  return data.teamKey;
}

async function loginViaForm(page, { name, role, team, key }) {
  await page.goto("/");
  await page.locator("#login-name").fill(name);
  await page.locator("#login-role").selectOption(role);
  if (role !== "admin") {
    await page.locator("#login-team").fill(team);
  }
  await page.locator("#login-key").fill(key);
  await page.getByRole("button", { name: "Enter Lobby" }).click();
}

function attachErrorListeners(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // login.js probes /api/me before sign-in; the 401 is the expected
    // "not signed in yet" signal, not a regression.
    if (/401 \(Unauthorized\)/.test(text)) return;
    errs.push(text);
  });
  return errs;
}

async function assertSizedCanvas(band) {
  await expect
    .poll(async () => band.locator("canvas").first().evaluate((c) => c.width))
    .toBeGreaterThan(0);
}

async function assertBand(page, title) {
  const band = page.locator(".header-band[data-breathing-waves]").first();
  await expect(band).toBeVisible();
  await expect(band.locator("canvas").first()).toHaveAttribute("aria-hidden", "true");
  await expect(band.locator(".header-title").first()).toContainText(title);
  await assertSizedCanvas(band);
}

test.describe("breathing-waves header band", () => {
  test("renders on public pages with aria-hidden canvas", async ({ page }) => {
    const errs = attachErrorListeners(page);
    await page.goto("/");
    await assertBand(page, "Run focused retros with your team.");
    await page.goto("/license");
    await assertBand(page, "Retrospective App Proprietary Free-Use Licence");
    expect(errs).toEqual([]);
  });

  test("renders on admin page with aria-hidden canvas", async ({ page }) => {
    const errs = attachErrorListeners(page);
    await loginViaForm(page, { name: "Waves Admin", role: "admin", team: "Admin", key: "admn1" });
    await expect(page).toHaveURL(/\/admin$/);
    await assertBand(page, "Team Keys");
    expect(errs).toEqual([]);
  });

  test("renders on lobby and actions pages with aria-hidden canvas", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const team = `Waves Team ${suffix}`;
    const teamKey = await createTeamViaAdmin(page, team);

    const errs = attachErrorListeners(page);
    await loginViaForm(page, {
      name: "Waves Facilitator",
      role: "facilitator",
      team,
      key: teamKey
    });
    await expect(page).toHaveURL(/\/lobby$/);
    await assertBand(page, "Retrospectives");

    await page.goto("/actions");
    await assertBand(page, "Actions Report");
    expect(errs).toEqual([]);
  });
});
