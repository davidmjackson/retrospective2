const userSummary = document.getElementById("user-summary");
const retroList = document.getElementById("retro-list");
const sortSelect = document.getElementById("sort-select");
const createPanel = document.getElementById("create-panel");
const createForm = document.getElementById("create-form");
const createTitle = document.getElementById("create-title");
const createTeam = document.getElementById("create-team");

const userName = localStorage.getItem("retroUserName");
const userRole = localStorage.getItem("retroUserRole") || "participant";
const userTeam = localStorage.getItem("retroUserTeam");

if (!userName || !userTeam) {
  window.location.href = "/";
}

userSummary.textContent = `${userName} · ${userRole} · ${userTeam}`;

if (userRole !== "facilitator") {
  createPanel.style.display = "none";
} else if (userTeam) {
  createTeam.value = userTeam;
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
    status.textContent = retro.closed ? "Closed" : "Open";
    actions.appendChild(status);

    const openLink = document.createElement("a");
    openLink.className = "primary-btn";
    openLink.href = `/retro?id=${encodeURIComponent(retro.id)}`;
    openLink.textContent = "Open";
    actions.appendChild(openLink);

    if (userRole === "facilitator" && !retro.closed) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "secondary-btn";
      closeBtn.textContent = "Close";
      closeBtn.addEventListener("click", async () => {
        await fetch(`/api/retros/${retro.id}/close`, { method: "POST" });
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
  const response = await fetch("/api/retros");
  const data = await response.json();
  retros = data.retros || [];
  renderRetros();
}

sortSelect.addEventListener("change", renderRetros);

if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = createTitle.value.trim();
    const team = createTeam.value.trim();
    if (!title || !team) {
      return;
    }
    const response = await fetch("/api/retros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, team })
    });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const retroId = data.retro?.id;
    if (retroId) {
      window.location.href = `/retro?id=${encodeURIComponent(retroId)}`;
    } else {
      await loadRetros();
    }
  });
}

loadRetros();
