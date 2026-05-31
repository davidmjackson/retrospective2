// Pure tenancy helpers. A board belongs to one hub team (retros.team_id); a user
// may touch it only when that team is among the teams on their verified session.
function teamIdInTeams(teamId, teams) {
  if (!teamId || !Array.isArray(teams)) return false;
  return teams.some((t) => t && t.id === teamId);
}

function boardTeamAllowed(retro, teams) {
  if (!retro) return false;
  return teamIdInTeams(retro.team_id, teams);
}

module.exports = { teamIdInTeams, boardTeamAllowed };
