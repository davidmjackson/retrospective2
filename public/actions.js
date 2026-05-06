const actionsBoard = document.getElementById("actions-board");
const actionsCount = document.getElementById("actions-count");

let userName = "";
let userRole = "participant";
let userTeam = "";

const STATUS_COLUMNS = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" }
];

let dragInstance = null;

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

function formatDate(value) {
  if (!value) {
    return "Unknown date";
  }
  const date = new Date(value);
  return date.toLocaleDateString();
}

function createActionCard(action) {
  const card = document.createElement("li");
  card.className = "action-card";
  card.dataset.retroId = action.retroId;
  card.dataset.actionId = action.actionId;
  card.dataset.status = action.status;

  const title = document.createElement("strong");
  title.textContent = action.text;
  card.appendChild(title);

  if (action.details) {
    const details = document.createElement("p");
    details.className = "card-details";
    details.textContent = action.details;
    card.appendChild(details);
  }

  const meta = document.createElement("p");
  meta.className = "action-meta";
  const owner = action.owner ? `Owner: ${action.owner}` : "Owner not set";
  meta.textContent = `${owner} · ${action.team} · ${action.retroTitle} · ${formatDate(
    action.createdAt
  )}`;
  card.appendChild(meta);

  const notesLabel = document.createElement("label");
  notesLabel.className = "action-notes";
  const span = document.createElement("span");
  span.textContent = "Notes";
  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.value = action.notes || "";
  notesLabel.appendChild(span);
  notesLabel.appendChild(textarea);
  card.appendChild(notesLabel);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "secondary-btn";
  saveBtn.textContent = "Save Notes";
  saveBtn.addEventListener("click", async () => {
    await updateAction(action.retroId, action.actionId, card.dataset.status, textarea.value);
  });
  card.appendChild(saveBtn);

  return card;
}

async function updateAction(retroId, actionId, status, notes) {
  const response = await fetchWithAuth("/api/actions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retroId, actionId, status, notes })
  });
  if (!response) {
    return;
  }
}

function renderBoard(actions) {
  actionsBoard.innerHTML = "";
  if (!actions.length) {
    const empty = document.createElement("div");
    empty.className = "panel";
    empty.textContent = "No action items yet.";
    actionsBoard.appendChild(empty);
    return;
  }
  const teams = Array.from(new Set(actions.map((action) => action.team))).sort();

  const containers = [];

  STATUS_COLUMNS.forEach((column) => {
    const columnEl = document.createElement("div");
    columnEl.className = "kanban-column";

    const header = document.createElement("div");
    header.className = "kanban-header";
    const title = document.createElement("h2");
    title.textContent = column.label;
    header.appendChild(title);
    columnEl.appendChild(header);

    teams.forEach((team) => {
      const teamSection = document.createElement("div");
      teamSection.className = "team-section";
      const teamTitle = document.createElement("h3");
      teamTitle.textContent = team;
      teamSection.appendChild(teamTitle);

      const list = document.createElement("ul");
      list.className = "action-list";
      list.dataset.status = column.key;
      list.dataset.team = team;

      actions
        .filter((action) => action.status === column.key && action.team === team)
        .forEach((action) => {
          list.appendChild(createActionCard(action));
        });

      teamSection.appendChild(list);
      columnEl.appendChild(teamSection);
      containers.push(list);
    });

    actionsBoard.appendChild(columnEl);
  });

  if (dragInstance) {
    dragInstance.destroy();
  }
  dragInstance = dragula(containers, {
    accepts: (el, target, source) => {
      if (!target || !source) {
        return false;
      }
      return target.dataset.team === source.dataset.team;
    }
  });
  dragInstance.on("drop", async (el, target) => {
    if (!target) {
      return;
    }
    const status = target.dataset.status;
    if (!status) {
      return;
    }
    el.dataset.status = status;
    const notesInput = el.querySelector("textarea");
    await updateAction(
      el.dataset.retroId,
      el.dataset.actionId,
      status,
      notesInput ? notesInput.value : ""
    );
  });
}

async function loadActions() {
  const response = await fetchWithAuth("/api/actions-report");
  if (!response) {
    return;
  }
  const data = await response.json();
  const actions = data.actions || [];
  actionsCount.textContent = `${actions.length} actions total`;
  renderBoard(actions);
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
  await loadActions();
}

init();
