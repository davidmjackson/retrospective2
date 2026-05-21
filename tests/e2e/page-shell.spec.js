const { test, expect } = require("@playwright/test");

async function createTeamViaAdmin(page, team) {
  const adminLogin = await page.request.post("/api/login", {
    data: {
      name: "E2E Admin",
      role: "admin",
      team: "Admin",
      key: "admn1"
    }
  });
  expect(adminLogin.ok()).toBeTruthy();
  const teamCreate = await page.request.post("/api/teams", {
    data: { team }
  });
  expect(teamCreate.status()).toBe(201);
  const data = await teamCreate.json();
  await page.request.post("/api/logout");
  return data.teamKey;
}

async function login(page, { name, role, team, key = "" }) {
  await page.goto("/");
  await page.locator("#login-name").fill(name);
  await page.locator("#login-role").selectOption(role);
  if (role !== "admin") {
    await page.locator("#login-team").fill(team);
  }
  await page.locator("#login-key").fill(key);
  await page.getByRole("button", { name: "Enter Lobby" }).click();
}

test("login page exposes the redesigned sign-in shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".login-shell")).toBeVisible();
  await expect(page.locator(".login-hero")).toContainText("Run focused retros");
  await expect(page.locator(".login-preview")).toBeVisible();
  await expect(page.locator(".auth-card")).toContainText("Welcome Back");
  await expect(page.getByRole("button", { name: "Enter Lobby" })).toBeVisible();
  await expect(page.locator("#login-create-team")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Licence" })).toHaveAttribute(
    "href",
    "/license"
  );
  await page.getByRole("link", { name: "Licence" }).click();
  await expect(page).toHaveURL(/\/license$/);
  await expect(page.locator(".legal-panel")).toContainText("David Jackson");
});

test("lobby and actions pages use the redesigned dashboard shell", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const team = `Shell Team ${suffix}`;
  const retroTitle = `Shell Retro ${suffix}`;
  const teamKey = await createTeamViaAdmin(page, team);

  await login(page, {
    name: "Shell Facilitator",
    role: "facilitator",
    team,
    key: teamKey
  });
  await expect(page).toHaveURL(/\/lobby$/);
  await expect(page.locator(".overview-grid")).toBeVisible();
  await expect(page.locator("#create-team-panel")).toBeVisible();

  const createdTeamName = `Shell Extra Team ${suffix}`;
  await page.locator("#new-team-name").fill(createdTeamName);
  await page.getByRole("button", { name: "Create Team Key" }).click();
  await expect(page.locator("#team-key-panel")).toBeVisible();
  await expect(page.locator("#team-key-team")).toHaveText(createdTeamName);
  await expect(page.locator("#team-key-value")).toHaveText(/^[a-z0-9]{12}$/);
  await page.locator("#team-key-dismiss").click();
  await expect(page.locator("#team-key-panel")).toBeHidden();

  await page.locator("#create-title").fill(retroTitle);
  await page.getByRole("button", { name: "Create Retro" }).click();
  await expect(page).toHaveURL(/\/retrospective\?id=/);
  await expect(page.locator("#status")).toHaveText("Live");
  await page.locator(".column-continue .column-add").click();
  await expect(page.locator("#note-dialog")).toBeVisible();
  await page.locator("#note-text").fill("Confirm action board styling");
  await page.locator("#note-save").click();
  await expect(page.locator("#note-dialog")).toBeHidden();
  const continueCard = page
    .locator("#col-continue .card")
    .filter({ hasText: "Confirm action board styling" });
  await expect(continueCard).toContainText("Confirm action board styling");
  await expect(continueCard.locator(".avatar")).toHaveText("SF");
  await expect(page.locator(".retro-health")).toContainText("Retro Health");
  await expect(page.locator("#stat-notes")).toHaveText("1");
  await expect(page.locator("#stat-actions")).toHaveText("0");
  await expect(page.locator("#count-continue")).toHaveText("1");
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
  await expect(
    page.locator(".header-actions").getByRole("link", { name: "Actions" })
  ).toHaveClass(/primary-btn/);
  await expect(
    page.locator(".header-actions").getByRole("link", { name: "Lobby" })
  ).toHaveClass(/secondary-btn/);

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
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator(".action-field").filter({ hasText: "Owner" }).locator("input"))
    .toHaveValue("Updated Lead");
  await expect(page.locator(".action-field").filter({ hasText: "Due date" }).locator("input"))
    .toHaveValue("2026-05-22");
  await expect(page.locator(".action-card textarea")).toHaveValue("Updated report notes.");

  await page.goto("/lobby");
  await expect(page.locator(".retro-item").filter({ hasText: retroTitle })).toBeVisible();
});

test("admin page rotates a team key through the reveal dialog", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const rotateTeam = `Rotate Team ${suffix}`;
  await createTeamViaAdmin(page, rotateTeam);

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

  const teamRow = page.locator("#team-table-body tr", { hasText: rotateTeam });
  await teamRow.getByRole("button", { name: "Rotate key" }).click();
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await page.locator("#confirm-accept").click();
  await expect(page.locator("#key-reveal-dialog")).toBeVisible();
  await expect(page.locator("#key-reveal-value")).toHaveText(/^[a-z0-9]{12}$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#key-reveal-dialog")).toBeHidden();
});

test("mobile retrospective timer controls remain compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const suffix = Date.now().toString(36);
  const team = `Mobile Shell ${suffix}`;
  const teamKey = await createTeamViaAdmin(page, team);

  await login(page, {
    name: "Mobile Facilitator",
    role: "facilitator",
    team,
    key: teamKey
  });
  await expect(page).toHaveURL(/\/lobby$/);
  await page.locator("#create-title").fill(`Mobile Shell Retro ${suffix}`);
  await page.getByRole("button", { name: "Create Retro" }).click();
  await expect(page).toHaveURL(/\/retrospective\?id=/);
  await expect(page.locator("#status")).toHaveText("Live");

  const timerControls = page.locator(".timer-controls");
  await expect(page.locator(".timer-readout")).toContainText("Time remaining");
  await expect(page.locator("#timer-display")).toBeVisible();
  await expect(page.locator("#timer-complete-sound")).toHaveAttribute(
    "src",
    "sounds/timer-complete.wav"
  );
  await expect(timerControls).toBeVisible();
  await expect(timerControls).toHaveCSS("display", "grid");
  const timerControlsBox = await timerControls.boundingBox();
  expect(timerControlsBox.width).toBeLessThanOrEqual(360);
  await expect(page.locator(".timer-actions")).toHaveCSS(
    "grid-template-columns",
    /.+ .+ .+/
  );
});
