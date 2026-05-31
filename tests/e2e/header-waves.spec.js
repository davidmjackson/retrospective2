const { test, expect } = require("@playwright/test");
const { seedSession } = require("./helpers/seed");
const { injectSession } = require("./helpers/_auth");

function attachErrorListeners(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // auth-client probes /api/me before sign-in; the 401 is expected.
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
  const band = page.locator("[data-breathing-waves] canvas").first();
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("aria-hidden", "true");
  const header = page.locator(".header-band[data-breathing-waves]").first();
  await expect(header.locator(".header-title").first()).toContainText(title);
  await assertSizedCanvas(header);
}

test.describe("breathing-waves header band", () => {
  test("renders on lobby with aria-hidden canvas and correct title", async ({ page, context }) => {
    const errs = attachErrorListeners(page);
    seedSession();
    await injectSession(context);
    await page.goto("/lobby");
    await assertBand(page, "Retrospectives");
    expect(errs).toEqual([]);
  });
});
