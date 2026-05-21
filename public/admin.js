const adminSummary = document.getElementById("admin-summary");
const logoutBtn = document.getElementById("logout-btn");
const teamTableBody = document.getElementById("team-table-body");
const teamCount = document.getElementById("team-count");
const keyRevealDialog = document.getElementById("key-reveal-dialog");
const keyRevealTeam = document.getElementById("key-reveal-team");
const keyRevealValue = document.getElementById("key-reveal-value");
const keyRevealCopy = document.getElementById("key-reveal-copy");
const keyRevealClose = document.getElementById("key-reveal-close");
const keyRevealDone = document.getElementById("key-reveal-done");
const confirmDialog = document.getElementById("confirm-dialog");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmAccept = document.getElementById("confirm-accept");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmClose = document.getElementById("confirm-close");

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

function closeKeyReveal() {
  if (keyRevealDialog && keyRevealDialog.open) {
    keyRevealDialog.close();
  }
  if (keyRevealValue) {
    keyRevealValue.textContent = "";
  }
}

function showKeyReveal(teamName, key) {
  if (!keyRevealDialog || !keyRevealValue) {
    return;
  }
  if (keyRevealTeam) {
    keyRevealTeam.textContent = teamName;
  }
  keyRevealValue.textContent = key;
  if (keyRevealCopy) {
    keyRevealCopy.textContent = "Copy";
  }
  if (typeof keyRevealDialog.showModal === "function") {
    keyRevealDialog.showModal();
  } else {
    keyRevealDialog.setAttribute("open", "");
  }
}

async function rotateTeam(team) {
  const confirmed = await confirmAction({
    title: "Rotate team key",
    message: `Rotate the key for ${team.name}? The current key stops working immediately and cannot be recovered.`,
    confirmLabel: "Rotate key"
  });
  if (!confirmed) {
    return;
  }
  const response = await fetchWithAuth(`/api/admin/teams/${team.id}/rotate`, {
    method: "POST"
  });
  if (!response || !response.ok) {
    return;
  }
  const data = await response.json().catch(() => ({}));
  if (!data.teamKey) {
    return;
  }
  showKeyReveal(data.team || team.name, data.teamKey);
  await loadTeams();
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
    const isAdminTeam = team.name.toLowerCase() === "admin";
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = team.name;

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = team.weak ? "pill closed" : "pill open";
    statusBadge.textContent = team.weak ? "Weak key" : "OK";
    statusCell.appendChild(statusBadge);

    const createdCell = document.createElement("td");
    createdCell.textContent = formatDate(team.created_at);

    const actionsCell = document.createElement("td");
    actionsCell.className = "action-buttons";

    const rotateBtn = document.createElement("button");
    rotateBtn.type = "button";
    rotateBtn.className = "secondary-btn";
    rotateBtn.textContent = "Rotate key";
    rotateBtn.disabled = isAdminTeam;
    if (isAdminTeam) {
      rotateBtn.title = "The Admin key is set with RETRO_ADMIN_KEY.";
    } else {
      rotateBtn.addEventListener("click", () => rotateTeam(team));
    }
    actionsCell.appendChild(rotateBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "link-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.disabled = isAdminTeam;
    deleteBtn.addEventListener("click", async () => {
      if (deleteBtn.disabled) {
        return;
      }
      const confirmed = await confirmAction({
        title: "Delete team",
        message: `Delete team ${team.name}? This removes the team and its retros.`,
        confirmLabel: "Delete team"
      });
      if (!confirmed) {
        return;
      }
      const response = await fetchWithAuth(`/api/admin/teams/${team.id}`, {
        method: "DELETE"
      });
      if (!response || !response.ok) {
        return;
      }
      await loadTeams();
    });
    actionsCell.appendChild(deleteBtn);

    row.appendChild(nameCell);
    row.appendChild(statusCell);
    row.appendChild(createdCell);
    row.appendChild(actionsCell);
    teamTableBody.appendChild(row);
  });
}

if (keyRevealClose) {
  keyRevealClose.addEventListener("click", closeKeyReveal);
}

if (keyRevealDone) {
  keyRevealDone.addEventListener("click", closeKeyReveal);
}

if (keyRevealDialog) {
  keyRevealDialog.addEventListener("click", (event) => {
    if (event.target === keyRevealDialog) {
      closeKeyReveal();
    }
  });
}

if (keyRevealCopy) {
  keyRevealCopy.addEventListener("click", async () => {
    const value = keyRevealValue ? keyRevealValue.textContent.trim() : "";
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      keyRevealCopy.textContent = "Copied";
      setTimeout(() => {
        keyRevealCopy.textContent = "Copy";
      }, 1500);
    } catch (err) {
      keyRevealCopy.textContent = "Copy";
    }
  });
}

let confirmResolver = null;

function settleConfirm(result) {
  if (confirmDialog && confirmDialog.open) {
    confirmDialog.close();
  }
  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve(result);
  }
}

function confirmAction({ title, message, confirmLabel }) {
  if (!confirmDialog || !confirmAccept) {
    return Promise.resolve(window.confirm(message || ""));
  }
  settleConfirm(false);
  return new Promise((resolve) => {
    confirmResolver = resolve;
    if (confirmTitle) {
      confirmTitle.textContent = title || "Confirm";
    }
    if (confirmMessage) {
      confirmMessage.textContent = message || "";
    }
    confirmAccept.textContent = confirmLabel || "Confirm";
    if (typeof confirmDialog.showModal === "function") {
      confirmDialog.showModal();
    } else {
      confirmDialog.setAttribute("open", "");
    }
    confirmAccept.focus();
  });
}

if (confirmAccept) {
  confirmAccept.addEventListener("click", () => settleConfirm(true));
}

if (confirmCancel) {
  confirmCancel.addEventListener("click", () => settleConfirm(false));
}

if (confirmClose) {
  confirmClose.addEventListener("click", () => settleConfirm(false));
}

if (confirmDialog) {
  confirmDialog.addEventListener("click", (event) => {
    if (event.target === confirmDialog) {
      settleConfirm(false);
    }
  });
  confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    settleConfirm(false);
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
