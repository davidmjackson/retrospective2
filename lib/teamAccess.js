// Pure tenancy helpers. A board belongs to one hub team (retros.team_id); a user
// may touch it only when that team is among the teams on their verified session.
function teamIdInTeams(teamId, teams) {
  if (!teamId || !Array.isArray(teams)) return false;
  return teams.some((t) => t && t.id === teamId);
}

// Accepts either a DB row (team_id) or an in-memory normalized retro (teamId).
function boardTeamAllowed(retro, teams) {
  if (!retro) return false;
  return teamIdInTeams(retro.team_id || retro.teamId, teams);
}

module.exports = { teamIdInTeams, boardTeamAllowed };
