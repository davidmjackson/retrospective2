const loginForm = document.getElementById("login-form");
const nameInput = document.getElementById("login-name");
const roleInput = document.getElementById("login-role");
const teamInput = document.getElementById("login-team");
const keyInput = document.getElementById("login-key");
const createTeamToggle = document.getElementById("login-create-team");
const createTeamField = document.getElementById("create-team-field");
const keyField = document.getElementById("login-key-field");
const errorText = document.getElementById("login-error");

const storedName = localStorage.getItem("retroUserName");
const storedRole = localStorage.getItem("retroUserRole");
const storedTeam = localStorage.getItem("retroUserTeam");

if (storedName) {
  nameInput.value = storedName;
}
if (storedRole) {
  roleInput.value = storedRole;
}
if (storedTeam) {
  teamInput.value = storedTeam;
}

checkSession();
updateRoleUI();

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  errorText.textContent = "";
  const name = nameInput.value.trim();
  const team = teamInput.value.trim();
  if (!name || !team) {
    return;
  }
  const key = keyInput ? keyInput.value.trim().toLowerCase() : "";
  const createTeam = Boolean(createTeamToggle && createTeamToggle.checked);
  login(name, roleInput.value, team, key, createTeam);
});

roleInput.addEventListener("change", updateRoleUI);
if (createTeamToggle) {
  createTeamToggle.addEventListener("change", updateRoleUI);
}
if (keyInput) {
  keyInput.addEventListener("input", () => {
    keyInput.value = keyInput.value.toLowerCase();
  });
}

function updateRoleUI() {
  const isFacilitator = roleInput.value === "facilitator";
  const isAdmin = roleInput.value === "admin";
  if (createTeamField) {
    createTeamField.style.display = isFacilitator ? "block" : "none";
  }
  if ((!isFacilitator || isAdmin) && createTeamToggle) {
    createTeamToggle.checked = false;
  }
  const needsKey =
    isAdmin || !isFacilitator || !createTeamToggle || !createTeamToggle.checked;
  if (keyField) {
    keyField.style.display = needsKey ? "block" : "none";
  }
  if (keyInput) {
    keyInput.required = needsKey;
    if (!needsKey) {
      keyInput.value = "";
    }
  }
  if (isAdmin) {
    teamInput.value = "Admin";
    teamInput.disabled = true;
  } else {
    teamInput.disabled = false;
  }
}

async function checkSession() {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (!response.ok) {
    return;
  }
  const data = await response.json();
  if (!data.user) {
    return;
  }
  localStorage.setItem("retroUserName", data.user.name);
  localStorage.setItem("retroUserRole", data.user.role);
  localStorage.setItem("retroUserTeam", data.user.team);
  window.location.href = "/lobby";
}

async function login(name, role, team, key, createTeam) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, role, team, key, createTeam })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    errorText.textContent = data.error || "Login failed.";
    return;
  }
  const data = await response.json();
  const user = data.user || { name, role, team };
  localStorage.setItem("retroUserName", user.name);
  localStorage.setItem("retroUserRole", user.role);
  localStorage.setItem("retroUserTeam", user.team);
  if (data.teamKey && user.team) {
    localStorage.setItem("retroTeamKey", data.teamKey);
    localStorage.setItem("retroTeamKeyTeam", user.team);
  } else {
    localStorage.removeItem("retroTeamKey");
    localStorage.removeItem("retroTeamKeyTeam");
  }
  window.location.href = user.role === "admin" ? "/admin" : "/lobby";
}
