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
  await page.locator("#login-team").fill(team);
  await page.locator("#login-key").fill(key);
  await page.getByRole("button", { name: "Enter Lobby" }).click();
  await expect(page).toHaveURL(role === "admin" ? /\/admin$/ : /\/lobby$/);
}

test("core retrospective workflow works in the browser", async ({ browser }) => {
  const suffix = Date.now().toString(36);
  const team = `E2E Team ${suffix}`;
  const retroTitle = `Smoke Retro ${suffix}`;
  const facilitatorContext = await browser.newContext();
  const participantContext = await browser.newContext();
  const facilitator = await facilitatorContext.newPage();
  const participant = await participantContext.newPage();

  try {
    const teamKey = await createTeamViaAdmin(facilitator, team);
    await login(facilitator, {
      name: "Facilitator",
      role: "facilitator",
      team,
      key: teamKey
    });

    await expect(facilitator.locator("#user-summary")).toContainText("facilitator");
    await expect(facilitator.locator("#create-team-panel")).toBeVisible();

    await facilitator.locator("#create-title").fill(retroTitle);
    await facilitator.getByRole("button", { name: "Create Retro" }).click();
    await expect(facilitator).toHaveURL(/\/retrospective\?id=/);
    const retroUrl = facilitator.url();
    await expect(facilitator.locator("#status")).toHaveText("Live");
    await expect(facilitator.locator("#retro-title")).toHaveText(retroTitle);
    await facilitator.getByRole("button", { name: "Show instructions" }).click();
    await expect(facilitator.locator("#instructions-dialog")).toBeVisible();
    await expect(facilitator.locator("#instructions-dialog")).toContainText(
      "How to run the retrospective"
    );
    await expect(facilitator.locator("#instructions-dialog")).toContainText(
      "Use the board to gather notes, vote on priorities, and create follow-up actions."
    );
    await facilitator.getByRole("button", { name: "Got it" }).click();
    await expect(facilitator.locator("#instructions-dialog")).toBeHidden();

    await facilitator.locator(".column-continue .column-add").click();
    await expect(facilitator.locator("#note-dialog")).toBeVisible();
    await facilitator.locator("#note-text").fill("Follow up on release checklist");
    await facilitator.locator("#note-details").fill("Owner and due date needed");
    await facilitator.locator("#note-save").click();
    await expect(facilitator.locator("#note-dialog")).toBeHidden();
    const followUpCard = facilitator
      .locator("#col-continue .card")
      .filter({ hasText: "Follow up on release checklist" });
    await expect(followUpCard).toBeVisible();
    await expect(facilitator.locator("#stat-actions")).toHaveText("0");
    await followUpCard.getByRole("button", { name: /Create action/ }).click();
    await expect(facilitator.locator("#action-dialog")).toBeVisible();
    await facilitator.locator("#action-owner").fill("Release Owner");
    await facilitator.locator("#action-due-date").fill("2026-05-20");
    await facilitator.locator("#action-notes").fill("Confirm owner and due date.");
    await facilitator
      .locator("#action-form")
      .getByRole("button", { name: "Create action" })
      .click();
    await expect(facilitator.locator("#stat-actions")).toHaveText("1");

    await facilitator.locator("#timer-minutes").fill("1");
    await facilitator.locator("#timer-start").click();
    await expect(facilitator.locator("#timer-display")).toHaveText("01:00");
    await expect(facilitator.locator("#timer-display")).toHaveText(/00:5[0-9]/, {
      timeout: 5000
    });
    await facilitator.locator("#timer-stop").click();
    await facilitator.locator("#timer-reset").click();
    await expect(facilitator.locator("#timer-display")).toHaveText("01:00");

    await login(participant, {
      name: "Participant",
      role: "participant",
      team,
      key: teamKey
    });
    await participant.goto(retroUrl);
    await expect(participant.locator("#status")).toHaveText("Live");
    await participant.locator(".column-start .column-add").click();
    await expect(participant.locator("#note-dialog")).toBeVisible();
    await participant.locator("#note-text").fill("The demo flow is clear");
    await participant.locator("#note-save").click();
    await expect(participant.locator("#note-dialog")).toBeHidden();
    const participantCard = participant
      .locator("#col-well .card")
      .filter({ hasText: "The demo flow is clear" });
    await expect(participantCard).toBeVisible();
    await participantCard.locator(".vote-btn").click();
    await expect(participantCard.locator(".vote-count")).toHaveText("1");
    await expect(
      facilitator.locator("#col-well .card").filter({ hasText: "The demo flow is clear" })
    ).toBeVisible();

    await participant.goto("/lobby");
    const participantRetroRow = participant
      .locator(".retro-item")
      .filter({ hasText: retroTitle });
    await expect(participantRetroRow).toContainText("Status: Open");

    await facilitator.goto("/actions");
    await expect(facilitator.locator("#actions-count")).toHaveText("1 actions total");
    await expect(facilitator.locator(".action-card")).toContainText(
      "Follow up on release checklist"
    );
    await expect(
      facilitator.locator(".action-field").filter({ hasText: "Owner" }).locator("input")
    ).toHaveValue("Release Owner");

    await facilitator.goto("/lobby");
    const retroRow = facilitator.locator(".retro-item").filter({ hasText: retroTitle });
    await expect(retroRow).toContainText("Status: Open");
    await retroRow.getByRole("button", { name: "Close" }).click();
    await expect(retroRow).toContainText("Status: Closed");
    await expect(participantRetroRow).toContainText("Status: Closed");

    await facilitator.goto(retroUrl);
    await expect(facilitator.locator("body")).toHaveClass(/read-only/);
    await expect(facilitator.locator("#retro-status")).toContainText("Closed");
    await expect(facilitator.locator(".column-add").first()).toBeHidden();
  } finally {
    await participantContext.close();
    await facilitatorContext.close();
  }
});
