const statusEl = document.getElementById("status");
const activityEl = document.getElementById("activity");
const presenceEl = document.getElementById("presence");
const retroTitle = document.getElementById("retro-title");
const retroMeta = document.getElementById("retro-meta");
const retroStatus = document.getElementById("retro-status");
const timerDisplay = document.getElementById("timer-display");
const timerMinutesInput = document.getElementById("timer-minutes");
const timerInc = document.getElementById("timer-inc");
const timerDec = document.getElementById("timer-dec");
const timerStart = document.getElementById("timer-start");
const timerStop = document.getElementById("timer-stop");
const timerReset = document.getElementById("timer-reset");
const timerControls = document.querySelector(".timer-controls");
const columns = {
  well: document.getElementById("col-well"),
  improve: document.getElementById("col-improve"),
  action: document.getElementById("col-action")
};

const params = new URLSearchParams(window.location.search);
const retroId = params.get("id");

let currentState = {
  columns: {
    well: [],
    improve: [],
    action: []
  },
  lastAction: null
};

let username = localStorage.getItem("retroUserName") || "Anonymous";
let userRole = localStorage.getItem("retroUserRole") || "participant";
let userTeam = localStorage.getItem("retroUserTeam") || "";
let isFacilitator = userRole === "facilitator";
let isReadOnly = false;

let remainingSeconds = 5 * 60;
let lastRemainingSeconds = remainingSeconds;
let audioContext = null;
let socket = null;

if (!retroId) {
  window.location.href = "/lobby";
}

if (!localStorage.getItem("retroUserName") || !userTeam) {
  window.location.href = "/";
}

function renderState(state) {
  Object.keys(columns).forEach((key) => {
    columns[key].innerHTML = "";
    const sortedCards = [...state.columns[key]].sort((a, b) => {
      return (b.votes || 0) - (a.votes || 0);
    });
    sortedCards.forEach((card) => {
      const li = document.createElement("li");
      li.className = "card";
      li.dataset.id = card.id;
      li.dataset.text = card.text;
      li.dataset.votes = String(card.votes || 0);
      li.dataset.details = card.details || "";
      if (key === "action") {
        li.dataset.status = card.status || "todo";
        li.dataset.notes = card.notes || "";
      }
      const strong = document.createElement("strong");
      strong.textContent = card.text;
      li.appendChild(strong);
      if (card.details) {
        const details = document.createElement("p");
        details.className = "card-details";
        details.textContent = card.details;
        li.appendChild(details);
      }
      const footer = document.createElement("div");
      footer.className = "card-footer";
      const votes = document.createElement("span");
      votes.className = "vote-count";
      votes.textContent = `${card.votes || 0} votes`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vote-btn";
      button.textContent = "+1";
      footer.appendChild(votes);
      footer.appendChild(button);
      li.appendChild(footer);
      columns[key].appendChild(li);
    });
  });

  if (state.lastAction && state.lastAction.user) {
    activityEl.textContent = `${state.lastAction.user} ${state.lastAction.action}`;
  }
}

function readStateFromDom() {
  const nextState = { columns: { well: [], improve: [], action: [] } };
  Object.keys(columns).forEach((key) => {
    const items = columns[key].querySelectorAll(".card");
    items.forEach((item) => {
      const card = {
        id: item.dataset.id,
        text: item.dataset.text,
        details: item.dataset.details || "",
        votes: Number.parseInt(item.dataset.votes || "0", 10)
      };
      if (key === "action") {
        card.status = item.dataset.status || "todo";
        card.notes = item.dataset.notes || "";
      }
      nextState.columns[key].push(card);
    });
  });
  return nextState;
}

function sendState(state) {
  if (!socket || socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify({ type: "setState", state }));
}

function sendMessage(payload) {
  if (!socket || socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(remainingSeconds);
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

function playTimerSound() {
  if (!audioContext) {
    return;
  }
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.2;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  setTimeout(() => {
    oscillator.stop();
  }, 600);
}

timerInc.addEventListener("click", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  const value = Number.parseInt(timerMinutesInput.value || "1", 10) + 1;
  timerMinutesInput.value = String(value);
  sendMessage({ type: "timer", action: "set", minutes: value });
});

timerDec.addEventListener("click", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  const value = Number.parseInt(timerMinutesInput.value || "1", 10) - 1;
  const minutes = Math.max(1, value);
  timerMinutesInput.value = String(minutes);
  sendMessage({ type: "timer", action: "set", minutes });
});

timerMinutesInput.addEventListener("change", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  const minutes = Math.max(1, Number.parseInt(timerMinutesInput.value || "1", 10));
  timerMinutesInput.value = String(minutes);
  sendMessage({ type: "timer", action: "set", minutes });
});

timerStart.addEventListener("click", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  ensureAudioContext();
  sendMessage({ type: "timer", action: "start" });
});

timerStop.addEventListener("click", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  sendMessage({ type: "timer", action: "stop" });
});

timerReset.addEventListener("click", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  sendMessage({ type: "timer", action: "reset" });
});

updateTimerDisplay();
document.addEventListener("click", ensureAudioContext, { once: true });

function applyReadOnlyState() {
  document.body.classList.toggle("read-only", isReadOnly);
  if (timerControls) {
    timerControls.style.display = isFacilitator && !isReadOnly ? "flex" : "none";
  }
}

if (timerControls) {
  timerControls.style.display = "none";
}

const drake = dragula([columns.well, columns.improve, columns.action], {
  moves: () => !isReadOnly
});

const handleDragUpdate = () => {
  currentState = readStateFromDom();
  currentState.lastAction = {
    user: username,
    action: "moved a card"
  };
  sendState(currentState);
};

drake.on("drop", handleDragUpdate);

Object.values(columns).forEach((listEl) => {
  listEl.addEventListener("click", (event) => {
    if (isReadOnly) {
      return;
    }
    const button = event.target.closest(".vote-btn");
    if (!button) {
      return;
    }
    const cardEl = button.closest(".card");
    if (!cardEl) {
      return;
    }
    const currentVotes = Number.parseInt(cardEl.dataset.votes || "0", 10);
    const nextVotes = currentVotes + 1;
    cardEl.dataset.votes = String(nextVotes);
    const counter = cardEl.querySelector(".vote-count");
    if (counter) {
      counter.textContent = `${nextVotes} votes`;
    }
    currentState = readStateFromDom();
    currentState.lastAction = {
      user: username,
      action: "added a vote"
    };
    sendState(currentState);
  });
});

const form = document.getElementById("card-form");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (isReadOnly) {
    return;
  }
  const textInput = document.getElementById("card-text");
  const detailsInput = document.getElementById("card-details");
  const columnSelect = document.getElementById("card-column");
  const text = textInput.value.trim();
  const details = detailsInput.value.trim();
  if (!text) {
    return;
  }
  const newCard = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    details,
    votes: 0
  };
  if (columnSelect.value === "action") {
    newCard.status = "todo";
    newCard.notes = "";
  }

  currentState = readStateFromDom();
  currentState.columns[columnSelect.value].push(newCard);
  currentState.lastAction = {
    user: username,
    action: "added a card"
  };
  renderState(currentState);
  sendState(currentState);

  textInput.value = "";
  detailsInput.value = "";
  textInput.focus();
});

async function loadRetroMeta() {
  const response = await fetch(`/api/retros/${encodeURIComponent(retroId)}`);
  if (!response.ok) {
    window.location.href = "/lobby";
    return;
  }
  const data = await response.json();
  const retro = data.retro;
  if (!retro) {
    window.location.href = "/lobby";
    return;
  }
  retroTitle.textContent = retro.title;
  retroMeta.textContent = `${retro.team} · ${new Date(
    retro.createdAt
  ).toLocaleString()}`;
  isReadOnly = retro.closed;
  retroStatus.classList.remove("open", "closed");
  if (retro.closed) {
    retroStatus.textContent = `Closed ${retro.closedAt ? `· ${new Date(retro.closedAt).toLocaleDateString()}` : ""}`;
    retroStatus.classList.add("closed");
  } else {
    retroStatus.textContent = "Open";
    retroStatus.classList.add("open");
  }
  applyReadOnlyState();
}

function connectSocket() {
  const socketProtocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${socketProtocol}://${location.host}?retroId=${encodeURIComponent(retroId)}`);

  socket.addEventListener("open", () => {
    statusEl.textContent = "Live";
    statusEl.classList.add("online");
    socket.send(JSON.stringify({ type: "hello", user: username }));
  });

  socket.addEventListener("close", () => {
    statusEl.textContent = "Offline";
    statusEl.classList.remove("online");
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "init" || data.type === "update") {
      currentState = data.retro;
      renderState(currentState);
      if (currentState.timer) {
        remainingSeconds = currentState.timer.remainingSeconds;
        lastRemainingSeconds = remainingSeconds;
        timerMinutesInput.value = String(
          Math.max(1, Math.ceil(currentState.timer.durationSeconds / 60))
        );
        updateTimerDisplay();
      }
      if (typeof data.retro.closed === "boolean") {
        isReadOnly = data.retro.closed;
        applyReadOnlyState();
      }
    }

    if (data.type === "timer" && data.timer) {
      remainingSeconds = data.timer.remainingSeconds;
      timerMinutesInput.value = String(
        Math.max(1, Math.ceil(data.timer.durationSeconds / 60))
      );
      updateTimerDisplay();
      if (remainingSeconds === 0 && lastRemainingSeconds > 0) {
        playTimerSound();
      }
      lastRemainingSeconds = remainingSeconds;
    }

    if (data.type === "presence") {
      const users = data.users || [];
      presenceEl.textContent = `Online: ${users.length} ${users.join(", ")}`;
    }

    if (data.type === "retroClosed") {
      isReadOnly = true;
      retroStatus.textContent = "Closed";
      retroStatus.classList.remove("open");
      retroStatus.classList.add("closed");
      applyReadOnlyState();
    }
  });
}

loadRetroMeta().then(connectSocket);
