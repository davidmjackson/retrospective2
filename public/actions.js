const actionsBoard = document.getElementById("actions-board");
const actionsCount = document.getElementById("actions-count");

const STATUS_COLUMNS = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" }
];

let dragInstance = null;

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
  meta.textContent = `${action.team} · ${action.retroTitle} · ${formatDate(
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
  await fetch("/api/actions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retroId, actionId, status, notes })
  });
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
  const response = await fetch("/api/actions-report");
  const data = await response.json();
  const actions = data.actions || [];
  actionsCount.textContent = `${actions.length} actions total`;
  renderBoard(actions);
}

loadActions();
