const adminSummary = document.getElementById("admin-summary");
const logoutBtn = document.getElementById("logout-btn");
const teamTableBody = document.getElementById("team-table-body");
const teamCount = document.getElementById("team-count");

function handleUnauthorized(response) {
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("retroUserName");
    localStorage.removeItem("retroUserRole");
    localStorage.removeItem("retroUserTeam");
    window.location.href = "/";
    return true;
  }
  return false;
}

async function fetchWithAuth(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: "same-origin" });
  if (handleUnauthorized(response)) {
    return null;
  }
  return response;
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    fetch("/api/logout", { method: "POST" });
    localStorage.removeItem("retroUserName");
    localStorage.removeItem("retroUserRole");
    localStorage.removeItem("retroUserTeam");
    window.location.href = "/";
  });
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  return date.toLocaleDateString();
}

function renderTeams(teams) {
  teamTableBody.innerHTML = "";
  if (!teams.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No teams found.";
    row.appendChild(cell);
    teamTableBody.appendChild(row);
    return;
  }
  teams.forEach((team) => {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = team.name;

    const keyCell = document.createElement("td");
    const keyBadge = document.createElement("span");
    keyBadge.className = "key-badge";
    keyBadge.textContent = team.join_key;
    keyCell.appendChild(keyBadge);

    const createdCell = document.createElement("td");
    createdCell.textContent = formatDate(team.created_at);

    const actionsCell = document.createElement("td");
    actionsCell.className = "action-buttons";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "secondary-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(team.join_key);
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1500);
      } catch (err) {
        copyBtn.textContent = "Copy";
      }
    });
    actionsCell.appendChild(copyBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "link-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.disabled = team.name.toLowerCase() === "admin";
    deleteBtn.addEventListener("click", async () => {
      if (deleteBtn.disabled) {
        return;
      }
      const confirmed = window.confirm(
        `Delete team ${team.name}? This removes the team and its retros.`
      );
      if (!confirmed) {
        return;
      }
      const response = await fetchWithAuth(`/api/admin/teams/${team.id}`, {
        method: "DELETE"
      });
      if (!response) {
        return;
      }
      if (!response.ok) {
        return;
      }
      await loadTeams();
    });
    actionsCell.appendChild(deleteBtn);

    row.appendChild(nameCell);
    row.appendChild(keyCell);
    row.appendChild(createdCell);
    row.appendChild(actionsCell);
    teamTableBody.appendChild(row);
  });
}

async function loadSession() {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (!response.ok) {
    handleUnauthorized(response);
    return null;
  }
  const data = await response.json();
  if (!data.user) {
    handleUnauthorized({ status: 401 });
    return null;
  }
  if (data.user.role !== "admin") {
    window.location.href = "/lobby";
    return null;
  }
  localStorage.setItem("retroUserName", data.user.name || "");
  localStorage.setItem("retroUserRole", data.user.role || "admin");
  localStorage.setItem("retroUserTeam", data.user.team || "Admin");
  adminSummary.textContent = `${data.user.name} · ${data.user.team}`;
  return data.user;
}

async function loadTeams() {
  const response = await fetchWithAuth("/api/admin/teams");
  if (!response) {
    return;
  }
  const data = await response.json();
  const teams = data.teams || [];
  if (teamCount) {
    teamCount.textContent = `${teams.length} teams`;
  }
  renderTeams(teams);
}

async function init() {
  const session = await loadSession();
  if (!session) {
    return;
  }
  await loadTeams();
}

init();
