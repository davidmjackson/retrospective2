// Public anonymous join: validate the share token, collect a name, then hand
// off to the shared board view. No auth, no lobby.
const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const titleEl = document.getElementById("join-board-title");
const errorEl = document.getElementById("join-error");
const formEl = document.getElementById("join-form");
const nameEl = document.getElementById("join-name");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  titleEl.hidden = true;
  formEl.hidden = true;
}

async function start() {
  if (!token) {
    showError("This link is missing its code.");
    return;
  }
  let res;
  try {
    res = await fetch(`/api/shared/${encodeURIComponent(token)}`);
  } catch (err) {
    showError("Could not reach the server. Try again.");
    return;
  }
  if (res.status === 410) {
    showError("This retro has ended.");
    return;
  }
  if (!res.ok) {
    showError("This link is not valid.");
    return;
  }
  const data = await res.json();
  const board = data.board;
  titleEl.textContent = `Joining: ${board.title}`;
  formEl.hidden = false;
  nameEl.value = localStorage.getItem("retroUserName") || "";

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameEl.value.trim() || "Anonymous";
    localStorage.setItem("retroUserName", name);
    const q = new URLSearchParams({ token, board: board.id });
    window.location.href = `/shared?${q.toString()}`;
  });
}

start();
