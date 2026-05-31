const test = require("node:test");
const assert = require("node:assert");
const { teamIdInTeams, boardTeamAllowed } = require("../lib/teamAccess");

const teams = [{ id: "t1", name: "A", role: "lead" }, { id: "t2", name: "B", role: "member" }];

test("teamIdInTeams matches by id", () => {
  assert.strictEqual(teamIdInTeams("t2", teams), true);
  assert.strictEqual(teamIdInTeams("t9", teams), false);
  assert.strictEqual(teamIdInTeams("t1", null), false);
});

test("boardTeamAllowed requires the board's team_id to be in the user's teams", () => {
  assert.strictEqual(boardTeamAllowed({ team_id: "t1" }, teams), true);
  assert.strictEqual(boardTeamAllowed({ team_id: "t9" }, teams), false);
  assert.strictEqual(boardTeamAllowed(null, teams), false);
});
