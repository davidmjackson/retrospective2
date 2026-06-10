// Lobby: hub identity (via /api/me) + self-declared name/role + company scope.
const userSummary = document.getElementById("user-summary");
const retroList = document.getElementById("retro-list");
const sortSelect = document.getElementById("sort-select");
const sessionForm = document.getElementById("session-form");
const createForm = document.getElementById("create-form");
const createTitle = document.getElementById("create-title");
const nameInput = document.getElementById("display-name");
const roleSelect = document.getElementById("role-select");
const companyName = document.getElementById("company-name");
const logoutBtn = document.getElementById("logout-btn");

// Prevent default form submission on the session settings form (name/role inputs).
if (sessionForm) {
  sessionForm.addEventListener("submit", (e) => e.preventDefault());
}

let currentCompany = null;
let retros = [];
let lobbySocket = null;

function getDisplayName() {
  return (nameInput && nameInput.value.trim()) || localStorage.getItem("retroUserName") || "";
}

function getSelectedRole() {
  const r = roleSelect ? roleSelect.value : "";
  return r === "facilitator" ? "facilitator" : "participant";
}

if (nameInput) {
  nameInput.value = localStorage.getItem("retroUserName") || "";
  nameInput.addEventListener("input", () => {
    localStorage.setItem("retroUserName", nameInput.value.trim());
  });
}
if (roleSelect) {
  roleSelect.value = localStorage.getItem("retroUserRole") || "participant";
  roleSelect.addEventListener("change", () => {
    localStorage.setItem("retroUserRole", roleSelect.value);
  });
}
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    window.location.href = "/auth/logout";
  });
}

function handleUnauthorized(response) {
  if (response.status === 401 || response.status === 403) {
    window.location.reload();
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

function formatDate(value) {
  if (!value) {
    return "Unknown date";
  }
  return new Date(value).toLocaleString();
}

function renderRetros() {
  retroList.innerHTML = "";
  const sorted = [...retros].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
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
    meta.textContent = formatDate(retro.createdAt);
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
    openLink.href = `/retrospective?retroId=${encodeURIComponent(retro.id)}`;
    openLink.textContent = "Open";
    actions.appendChild(openLink);

    if (!retro.closed) {
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
  if (!currentCompany) {
    return;
  }
  const response = await fetchWithAuth("/api/retros");
  if (!response) {
    return;
  }
  const data = await response.json();
  retros = data.retros || [];
  renderRetros();
}

function connectLobbySocket() {
  if (!currentCompany) {
    return;
  }
  if (lobbySocket) {
    try {
      lobbySocket.close();
    } catch (err) {
      // ignore
    }
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({
    view: "lobby",
    name: getDisplayName() || "Anonymous",
    role: getSelectedRole()
  });
  lobbySocket = new WebSocket(`${proto}://${location.host}/ws?${query.toString()}`);
  lobbySocket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "retros") {
      retros = data.retros || [];
      renderRetros();
    }
  });
  lobbySocket.addEventListener("close", (event) => {
    if (event.code === 4401 || event.code === 1008) {
      window.location.reload();
    }
  });
}

if (sortSelect) {
  sortSelect.addEventListener("change", renderRetros);
}

if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = createTitle.value.trim();
    if (!title || !currentCompany) {
      return;
    }
    const response = await fetchWithAuth("/api/retros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    if (!response || !response.ok) {
      return;
    }
    const data = await response.json();
    const retroId = data.retro && data.retro.id;
    if (retroId) {
      window.location.href = `/retrospective?retroId=${encodeURIComponent(retroId)}`;
    } else {
      await loadRetros();
    }
  });
}

async function init() {
  const response = await fetch("/api/me", { credentials: "same-origin" });
  if (!response.ok) {
    handleUnauthorized(response);
    return;
  }
  const data = await response.json();
  currentCompany = data.company || null;
  if (!currentCompany || !currentCompany.id) {
    userSummary.textContent = "No company on your account yet. Please sign in again.";
    if (companyName) companyName.textContent = "-";
    return;
  }
  if (companyName) companyName.textContent = currentCompany.name || currentCompany.id;

  const name = getDisplayName();
  userSummary.textContent = name ? `Signed in as ${name}` : "Enter your name to begin";

  loadRetros();
  connectLobbySocket();
}

init();
