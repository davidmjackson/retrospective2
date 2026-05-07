const { test, expect } = require("@playwright/test");

async function login(page, { name, role, team, key = "", createTeam = false }) {
  await page.goto("/");
  await page.locator("#login-name").fill(name);
  await page.locator("#login-role").selectOption(role);
  await page.locator("#login-team").fill(team);
  if (createTeam) {
    await page.locator("#login-create-team").check();
  } else {
    await page.locator("#login-key").fill(key);
  }
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
    await login(facilitator, {
      name: "Facilitator",
      role: "facilitator",
      team,
      createTeam: true
    });

    await expect(facilitator.locator("#user-summary")).toContainText("facilitator");
    await expect(facilitator.locator("#team-key-panel")).toBeVisible();
    const teamKey = (await facilitator.locator("#team-key-value").textContent()).trim();
    expect(teamKey).toMatch(/^[a-z0-9]{5}$/);

    await facilitator.locator("#create-title").fill(retroTitle);
    await facilitator.getByRole("button", { name: "Create Retro" }).click();
    await expect(facilitator).toHaveURL(/\/retrospective\?id=/);
    const retroUrl = facilitator.url();
    await expect(facilitator.locator("#status")).toHaveText("Live");
    await expect(facilitator.locator("#retro-title")).toHaveText(retroTitle);

    await facilitator.locator("#card-column").selectOption("continue");
    await facilitator.locator("#card-text").fill("Follow up on release checklist");
    await facilitator.locator("#card-details").fill("Owner and due date needed");
    await facilitator.getByRole("button", { name: "Add" }).click();
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
    await participant.locator("#card-column").selectOption("well");
    await participant.locator("#card-text").fill("The demo flow is clear");
    await participant.getByRole("button", { name: "Add" }).click();
    const participantCard = participant
      .locator("#col-well .card")
      .filter({ hasText: "The demo flow is clear" });
    await expect(participantCard).toBeVisible();
    await participantCard.getByRole("button", { name: "+1" }).click();
    await expect(participantCard.locator(".vote-count")).toHaveText("1");
    await expect(
      facilitator.locator("#col-well .card").filter({ hasText: "The demo flow is clear" })
    ).toBeVisible();

    await facilitator.goto("/actions");
    await expect(facilitator.locator("#actions-count")).toHaveText("1 actions total");
    await expect(facilitator.locator(".action-card")).toContainText(
      "Follow up on release checklist"
    );
    await expect(facilitator.locator(".action-card")).toContainText("Owner: Release Owner");

    await facilitator.goto("/lobby");
    const retroRow = facilitator.locator(".retro-item").filter({ hasText: retroTitle });
    await expect(retroRow).toContainText("Status: Open");
    await retroRow.getByRole("button", { name: "Close" }).click();
    await expect(retroRow).toContainText("Status: Closed");

    await facilitator.goto(retroUrl);
    await expect(facilitator.locator("body")).toHaveClass(/read-only/);
    await expect(facilitator.locator("#retro-status")).toContainText("Closed");
    await expect(facilitator.locator(".composer")).toBeHidden();
  } finally {
    await participantContext.close();
    await facilitatorContext.close();
  }
});
