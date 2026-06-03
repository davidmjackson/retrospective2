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

async function assertBand(page, title) {
  const band = page.locator(".band").first();
  await expect(band).toBeVisible();
  await expect(band.locator("h1").first()).toContainText(title);
  // oscilloscope.js mounts an <svg> trace into the empty .waves container.
  await expect
    .poll(async () => band.locator(".waves svg").count())
    .toBeGreaterThan(0);
}

test.describe("Instrument oscilloscope band", () => {
  test("renders on lobby with the oscilloscope trace and correct title", async ({ page, context }) => {
    const errs = attachErrorListeners(page);
    seedSession();
    await injectSession(context);
    await page.goto("/lobby");
    await assertBand(page, "Retrospectives");
    expect(errs).toEqual([]);
  });
});
