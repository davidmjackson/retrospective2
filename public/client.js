const statusEl = document.getElementById("status");
const activityEl = document.getElementById("activity");
const presenceEl = document.getElementById("presence");
const timerDisplay = document.getElementById("timer-display");
const timerMinutesInput = document.getElementById("timer-minutes");
const timerInc = document.getElementById("timer-inc");
const timerDec = document.getElementById("timer-dec");
const timerStart = document.getElementById("timer-start");
const timerStop = document.getElementById("timer-stop");
const timerReset = document.getElementById("timer-reset");
const timerControls = document.querySelector(".timer-controls");
const loginSection = document.getElementById("login");
const loginForm = document.getElementById("login-form");
const loginName = document.getElementById("login-name");
const loginRole = document.getElementById("login-role");
const columns = {
  well: document.getElementById("col-well"),
  improve: document.getElementById("col-improve"),
  action: document.getElementById("col-action")
};

const socketProtocol = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${socketProtocol}://${location.host}`);

let currentState = {
  columns: {
    well: [],
    improve: [],
    action: []
  },
  lastAction: null
};

let username = "Anonymous";
let isFacilitator = false;
let hasIdentity = false;

let remainingSeconds = 5 * 60;
let lastRemainingSeconds = remainingSeconds;
let audioContext = null;

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
      nextState.columns[key].push({
        id: item.dataset.id,
        text: item.dataset.text,
        details: item.dataset.details || "",
        votes: Number.parseInt(item.dataset.votes || "0", 10)
      });
    });
  });
  return nextState;
}

function sendState(state) {
  socket.send(JSON.stringify({ type: "setState", state }));
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
  if (!isFacilitator) {
    return;
  }
  const value = Number.parseInt(timerMinutesInput.value || "1", 10) + 1;
  timerMinutesInput.value = String(value);
  socket.send(JSON.stringify({ type: "timer", action: "set", minutes: value }));
});

timerDec.addEventListener("click", () => {
  if (!isFacilitator) {
    return;
  }
  const value = Number.parseInt(timerMinutesInput.value || "1", 10) - 1;
  const minutes = Math.max(1, value);
  timerMinutesInput.value = String(minutes);
  socket.send(JSON.stringify({ type: "timer", action: "set", minutes }));
});

timerMinutesInput.addEventListener("change", () => {
  if (!isFacilitator) {
    return;
  }
  const minutes = Math.max(1, Number.parseInt(timerMinutesInput.value || "1", 10));
  timerMinutesInput.value = String(minutes);
  socket.send(JSON.stringify({ type: "timer", action: "set", minutes }));
});

timerStart.addEventListener("click", () => {
  if (!isFacilitator) {
    return;
  }
  ensureAudioContext();
  socket.send(JSON.stringify({ type: "timer", action: "start" }));
});

timerStop.addEventListener("click", () => {
  if (!isFacilitator) {
    return;
  }
  socket.send(JSON.stringify({ type: "timer", action: "stop" }));
});

timerReset.addEventListener("click", () => {
  if (!isFacilitator) {
    return;
  }
  socket.send(JSON.stringify({ type: "timer", action: "reset" }));
});

updateTimerDisplay();
document.addEventListener("click", ensureAudioContext, { once: true });

if (timerControls) {
  timerControls.style.display = "none";
}

socket.addEventListener("open", () => {
  statusEl.textContent = "Live";
  statusEl.classList.add("online");
  if (hasIdentity) {
    socket.send(JSON.stringify({ type: "hello", user: username }));
  }
});

socket.addEventListener("close", () => {
  statusEl.textContent = "Offline";
  statusEl.classList.remove("online");
});

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "init" || data.type === "update") {
    currentState = data.state;
    renderState(currentState);
    if (currentState.timer) {
      remainingSeconds = currentState.timer.remainingSeconds;
      lastRemainingSeconds = remainingSeconds;
      timerMinutesInput.value = String(
        Math.max(1, Math.ceil(currentState.timer.durationSeconds / 60))
      );
      updateTimerDisplay();
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
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nameValue = loginName.value.trim();
  username = nameValue || "Anonymous";
  isFacilitator = loginRole.value === "facilitator";
  hasIdentity = true;
  if (timerControls) {
    timerControls.style.display = isFacilitator ? "flex" : "none";
  }
  if (loginSection) {
    loginSection.classList.add("hidden");
  }
  socket.send(JSON.stringify({ type: "hello", user: username }));
  loginName.value = "";
});

const drake = dragula([
  columns.well,
  columns.improve,
  columns.action
]);

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
