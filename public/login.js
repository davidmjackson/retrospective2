const loginForm = document.getElementById("login-form");
const nameInput = document.getElementById("login-name");
const roleInput = document.getElementById("login-role");
const teamInput = document.getElementById("login-team");

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

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const team = teamInput.value.trim();
  if (!name || !team) {
    return;
  }
  localStorage.setItem("retroUserName", name);
  localStorage.setItem("retroUserRole", roleInput.value);
  localStorage.setItem("retroUserTeam", team);
  window.location.href = "/lobby";
});
