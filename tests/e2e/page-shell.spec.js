const { test, expect } = require("@playwright/test");

async function login(page, { name, role, team, key = "", createTeam = false }) {
  await page.goto("/");
  await page.locator("#login-name").fill(name);
  await page.locator("#login-role").selectOption(role);
  if (role !== "admin") {
    await page.locator("#login-team").fill(team);
  }
  if (createTeam) {
    await page.locator("#login-create-team").check();
  } else {
    await page.locator("#login-key").fill(key);
  }
  await page.getByRole("button", { name: "Enter Lobby" }).click();
}

test("login page exposes the redesigned sign-in shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".login-shell")).toBeVisible();
  await expect(page.locator(".login-hero")).toContainText("Run focused retros");
  await expect(page.locator(".login-preview")).toBeVisible();
  await expect(page.locator(".auth-card")).toContainText("Welcome Back");
  await expect(page.getByRole("button", { name: "Enter Lobby" })).toBeVisible();
});

test("lobby and actions pages use the redesigned dashboard shell", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const team = `Shell Team ${suffix}`;
  const retroTitle = `Shell Retro ${suffix}`;

  await login(page, {
    name: "Shell Facilitator",
    role: "facilitator",
    team,
    createTeam: true
  });
  await expect(page).toHaveURL(/\/lobby$/);
  await expect(page.locator(".overview-grid")).toBeVisible();
  await expect(page.locator("#team-key-panel")).toBeVisible();

  await page.locator("#create-title").fill(retroTitle);
  await page.getByRole("button", { name: "Create Retro" }).click();
  await expect(page).toHaveURL(/\/retrospective\?id=/);
  await expect(page.locator("#status")).toHaveText("Live");
  await page.locator("#card-column").selectOption("continue");
  await page.locator("#card-text").fill("Confirm action board styling");
  await page.getByRole("button", { name: "Add note" }).click();
  const continueCard = page
    .locator("#col-continue .card")
    .filter({ hasText: "Confirm action board styling" });
  await expect(continueCard).toContainText("Confirm action board styling");
  await expect(page.locator(".retro-health")).toContainText("Retro Health");
  await expect(page.locator("#stat-notes")).toHaveText("1");
  await expect(page.locator("#stat-actions")).toHaveText("0");
  await expect(page.locator("#health-continue")).toHaveText("1");
  await continueCard.getByRole("button", { name: /Create action/ }).click();
  await expect(page.locator("#action-dialog")).toBeVisible();
  await expect(page.locator("#action-title")).toHaveValue("Confirm action board styling");
  await expect(page.locator("#action-owner")).toHaveValue("Shell Facilitator");
  await page.locator("#action-owner").fill("Delivery Lead");
  await page.locator("#action-due-date").fill("2026-05-15");
  await page.locator("#action-notes").fill("Confirm with the team in planning.");
  await page.locator("#action-form").getByRole("button", { name: "Create action" }).click();
  await expect(page.locator("#stat-actions")).toHaveText("1");
  await expect(
    continueCard.getByRole("button", { name: /Action already created/ })
  ).toBeDisabled();
  await expect(page.getByRole("link", { name: "View actions report" })).toHaveClass(
    /primary-btn/
  );
  await expect(page.getByRole("link", { name: "Return to lobby" })).toHaveClass(
    /secondary-btn/
  );

  await page.goto("/actions");
  await expect(page.locator(".actions-summary")).toBeVisible();
  await expect(page.locator(".actions-board")).toBeVisible();
  await expect(page.locator(".kanban-column")).toHaveCount(4);
  await expect(page.locator(".action-card")).toContainText(
    "Confirm action board styling"
  );
  await expect(page.locator(".action-field").filter({ hasText: "Owner" }).locator("input"))
    .toHaveValue("Delivery Lead");
  await expect(page.locator(".action-field").filter({ hasText: "Due date" }).locator("input"))
    .toHaveValue("2026-05-15");
  await page.locator(".action-field").filter({ hasText: "Owner" }).locator("input")
    .fill("Updated Lead");
  await page.locator(".action-field").filter({ hasText: "Due date" }).locator("input")
    .fill("2026-05-22");
  await page.locator(".action-card textarea").fill("Updated report notes.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await expect(page.locator(".action-field").filter({ hasText: "Owner" }).locator("input"))
    .toHaveValue("Updated Lead");
  await expect(page.locator(".action-field").filter({ hasText: "Due date" }).locator("input"))
    .toHaveValue("2026-05-22");
  await expect(page.locator(".action-card textarea")).toHaveValue("Updated report notes.");

  await page.goto("/lobby");
  await expect(page.locator(".retro-item").filter({ hasText: retroTitle })).toBeVisible();
});

test("admin page renders the team-key management shell", async ({ page }) => {
  await login(page, {
    name: "Admin",
    role: "admin",
    team: "Admin",
    key: "admn1"
  });

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator(".admin-summary")).toBeVisible();
  await expect(page.locator(".team-table")).toBeVisible();
  await expect(page.locator("#team-count")).toContainText("teams");
  await expect(page.locator("#team-table-body")).toContainText("Admin");
});

test("mobile retrospective timer controls remain compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const suffix = Date.now().toString(36);
  const team = `Mobile Shell ${suffix}`;

  await login(page, {
    name: "Mobile Facilitator",
    role: "facilitator",
    team,
    createTeam: true
  });
  await expect(page).toHaveURL(/\/lobby$/);
  await page.locator("#create-title").fill(`Mobile Shell Retro ${suffix}`);
  await page.getByRole("button", { name: "Create Retro" }).click();
  await expect(page).toHaveURL(/\/retrospective\?id=/);
  await expect(page.locator("#status")).toHaveText("Live");

  const timerControls = page.locator(".timer-controls");
  await expect(page.locator(".timer-readout")).toContainText("Time remaining");
  await expect(page.locator("#timer-display")).toBeVisible();
  await expect(timerControls).toBeVisible();
  await expect(timerControls).toHaveCSS("display", "grid");
  const timerControlsBox = await timerControls.boundingBox();
  expect(timerControlsBox.width).toBeLessThanOrEqual(360);
  await expect(page.locator(".timer-actions")).toHaveCSS(
    "grid-template-columns",
    /.+ .+ .+/
  );
});
