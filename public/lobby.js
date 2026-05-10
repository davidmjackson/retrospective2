const userSummary = document.getElementById("user-summary");
const retroList = document.getElementById("retro-list");
const sortSelect = document.getElementById("sort-select");
const createPanel = document.getElementById("create-panel");
const createForm = document.getElementById("create-form");
const createTitle = document.getElementById("create-title");
const createTeam = document.getElementById("create-team");
const createTeamPanel = document.getElementById("create-team-panel");
const createTeamForm = document.getElementById("create-team-form");
const newTeamName = document.getElementById("new-team-name");
const createTeamError = document.getElementById("create-team-error");
const logoutBtn = document.getElementById("logout-btn");
const teamKeyPanel = document.getElementById("team-key-panel");
const teamKeyValue = document.getElementById("team-key-value");
const teamKeyTeam = document.getElementById("team-key-team");
const teamKeyCopy = document.getElementById("team-key-copy");
const teamKeyDismiss = document.getElementById("team-key-dismiss");

let userName = "";
let userRole = "participant";
let userTeam = "";
let lobbySocket = null;

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

let retros = [];

function formatDate(value) {
  if (!value) {
    return "Unknown date";
  }
  const date = new Date(value);
  return date.toLocaleString();
}

function sortRetros(items, mode) {
  const copy = [...items];
  if (mode === "team") {
    copy.sort((a, b) => {
      const teamCompare = a.team.localeCompare(b.team);
      if (teamCompare !== 0) {
        return teamCompare;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return copy;
  }
  return copy.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderRetros() {
  retroList.innerHTML = "";
  const sorted = sortRetros(retros, sortSelect.value);
  if (!sorted.length) {
    const empty = document.createElement("li");
    empty.className = "retro-empty";
    empty.textContent = "No retros yet. Create a new one to get started.";
    retroList.appendChild(empty);
    return;
  }
  sorted.forEach((retro) => {
    const item = document.createElement("li");
    item.className = "retro-item";

    const info = document.createElement("div");
    info.className = "retro-info";
    const title = document.createElement("h3");
    title.textContent = retro.title;
    const meta = document.createElement("p");
    meta.textContent = `${retro.team} · ${formatDate(retro.createdAt)}`;
    info.appendChild(title);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "retro-actions";
    const status = document.createElement("span");
    status.className = retro.closed ? "pill closed" : "pill open";
    status.textContent = retro.closed ? "Status: Closed" : "Status: Open";
    actions.appendChild(status);

    const openLink = document.createElement("a");
    openLink.className = "primary-btn";
    openLink.href = `/retrospective?id=${encodeURIComponent(retro.id)}`;
    openLink.textContent = "Open";
    actions.appendChild(openLink);

    if (userRole === "facilitator" && !retro.closed) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "secondary-btn";
      closeBtn.textContent = "Close";
      closeBtn.addEventListener("click", async () => {
        await fetchWithAuth(`/api/retros/${retro.id}/close`, { method: "POST" });
        await loadRetros();
      });
      actions.appendChild(closeBtn);
    }

    item.appendChild(info);
    item.appendChild(actions);
    retroList.appendChild(item);
  });
}

async function loadRetros() {
  const response = await fetchWithAuth("/api/retros");
  if (!response) {
    return;
  }
  const data = await response.json();
  retros = data.retros || [];
  renderRetros();
}

function connectLobbySocket() {
  const socketProtocol = location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({ view: "lobby" });
  lobbySocket = new WebSocket(
    `${socketProtocol}://${location.host}?${query.toString()}`
  );

  lobbySocket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "error") {
      if (data.message === "Unauthorized.") {
        handleUnauthorized({ status: 401 });
        return;
      }
      window.location.href = "/lobby";
      return;
    }
    if (data.type === "retros") {
      retros = data.retros || [];
      renderRetros();
    }
  });
}

sortSelect.addEventListener("change", renderRetros);

function showTeamKey() {
  if (!teamKeyPanel || !teamKeyValue || !teamKeyTeam) {
    return;
  }
  const storedKey = localStorage.getItem("retroTeamKey");
  const storedTeam = localStorage.getItem("retroTeamKeyTeam");
  if (userRole !== "facilitator") {
    localStorage.removeItem("retroTeamKey");
    localStorage.removeItem("retroTeamKeyTeam");
  }
  if (
    userRole === "facilitator" &&
    storedKey &&
    storedTeam
  ) {
    teamKeyPanel.hidden = false;
    teamKeyValue.textContent = storedKey;
    teamKeyTeam.textContent = storedTeam;
  } else {
    teamKeyPanel.hidden = true;
  }
}

if (createTeamForm) {
  createTeamForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (createTeamError) {
      createTeamError.textContent = "";
    }
    const team = newTeamName ? newTeamName.value.trim() : "";
    if (!team) {
      return;
    }
    const response = await fetchWithAuth("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team })
    });
    if (!response) {
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (createTeamError) {
        createTeamError.textContent = data.error || "Unable to create team.";
      }
      return;
    }
    localStorage.setItem("retroTeamKey", data.teamKey);
    localStorage.setItem("retroTeamKeyTeam", data.team);
    if (newTeamName) {
      newTeamName.value = "";
    }
    showTeamKey();
  });
}

if (teamKeyCopy) {
  teamKeyCopy.addEventListener("click", async () => {
    const value = teamKeyValue ? teamKeyValue.textContent.trim() : "";
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      teamKeyCopy.textContent = "Copied";
      setTimeout(() => {
        teamKeyCopy.textContent = "Copy";
      }, 1500);
    } catch (err) {
      teamKeyCopy.textContent = "Copy";
    }
  });
}

if (teamKeyDismiss) {
  teamKeyDismiss.addEventListener("click", () => {
    localStorage.removeItem("retroTeamKey");
    localStorage.removeItem("retroTeamKeyTeam");
    if (teamKeyPanel) {
      teamKeyPanel.hidden = true;
    }
  });
}

if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = createTitle.value.trim();
    const team = createTeam.value.trim();
    if (!title || !team) {
      return;
    }
    const response = await fetchWithAuth("/api/retros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, team })
    });
    if (!response) {
      return;
    }
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const retroId = data.retro?.id;
    if (retroId) {
      window.location.href = `/retrospective?id=${encodeURIComponent(retroId)}`;
    } else {
      await loadRetros();
    }
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
  userName = data.user.name || "";
  userRole = data.user.role || "participant";
  userTeam = data.user.team || "";
  localStorage.setItem("retroUserName", userName);
  localStorage.setItem("retroUserRole", userRole);
  localStorage.setItem("retroUserTeam", userTeam);
  return data.user;
}

async function init() {
  const session = await loadSession();
  if (!session) {
    return;
  }
  userSummary.textContent = `${userName} · ${userRole} · ${userTeam}`;
  if (userRole === "admin") {
    window.location.href = "/admin";
    return;
  }
  if (userRole !== "facilitator") {
    createPanel.style.display = "none";
    if (createTeamPanel) {
      createTeamPanel.hidden = true;
    }
  } else if (userTeam) {
    if (createTeamPanel) {
      createTeamPanel.hidden = false;
    }
    createTeam.value = userTeam;
    createTeam.disabled = true;
  }
  showTeamKey();
  await loadRetros();
  connectLobbySocket();
}

init();
