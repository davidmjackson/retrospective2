const statusEl = document.getElementById("status");
const activityEl = document.getElementById("activity");
const presenceEl = document.getElementById("presence");
const retroTitle = document.getElementById("retro-title");
const retroMeta = document.getElementById("retro-meta");
const retroStatus = document.getElementById("retro-status");
const participantList = document.getElementById("participant-list");
const timerDisplay = document.getElementById("timer-display");
const timerMinutesInput = document.getElementById("timer-minutes");
const timerInc = document.getElementById("timer-inc");
const timerDec = document.getElementById("timer-dec");
const timerStart = document.getElementById("timer-start");
const timerStop = document.getElementById("timer-stop");
const timerReset = document.getElementById("timer-reset");
const timerControls = document.querySelector(".timer-controls");
const actionDialog = document.getElementById("action-dialog");
const actionForm = document.getElementById("action-form");
const actionCardIdInput = document.getElementById("action-card-id");
const actionTitleInput = document.getElementById("action-title");
const actionOwnerInput = document.getElementById("action-owner");
const actionDueDateInput = document.getElementById("action-due-date");
const actionNotesInput = document.getElementById("action-notes");
const actionCancel = document.getElementById("action-cancel");
const actionDismiss = document.getElementById("action-dismiss");
const healthStats = {
  notes: document.getElementById("stat-notes"),
  votes: document.getElementById("stat-votes"),
  actions: document.getElementById("stat-actions"),
  online: document.getElementById("stat-online"),
  status: document.getElementById("health-status"),
  statusDetail: document.getElementById("health-status-detail"),
  start: document.getElementById("health-start"),
  stop: document.getElementById("health-stop"),
  continueNotes: document.getElementById("health-continue"),
  healthVotes: document.getElementById("health-votes")
};
const columns = {
  well: document.getElementById("col-well"),
  improve: document.getElementById("col-improve"),
  continue: document.getElementById("col-continue")
};
const columnCounts = {
  well: document.getElementById("count-well"),
  improve: document.getElementById("count-improve"),
  continue: document.getElementById("count-continue")
};
const columnLabels = {
  well: "Start",
  improve: "Stop",
  continue: "Continue"
};

const params = new URLSearchParams(window.location.search);
const retroId = params.get("id");

let currentState = {
  columns: {
    well: [],
    improve: [],
    continue: []
  },
  actions: [],
  lastAction: null
};

let username = "Anonymous";
let userRole = "participant";
let userTeam = "";
let isFacilitator = userRole === "facilitator";
let isReadOnly = false;

let remainingSeconds = 5 * 60;
let lastRemainingSeconds = remainingSeconds;
let audioContext = null;
let socket = null;
let onlineUsers = 0;

if (!retroId) {
  window.location.href = "/lobby";
}

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

function fetchWithAuth(url, options = {}) {
  return fetch(url, { ...options, credentials: "same-origin" });
}

function getInitials(value) {
  const parts = String(value || "Anonymous")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return "A";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function getCardInitials(card) {
  return getInitials(card.author || card.createdBy || card.owner || "Anonymous");
}

function getRetroStats(state) {
  const stateColumns = state.columns || {};
  const counts = {
    well: (stateColumns.well || []).length,
    improve: (stateColumns.improve || []).length,
    continue: (stateColumns.continue || stateColumns.action || []).length
  };
  const actionItems = state.actions || [];
  const cards = [
    ...(stateColumns.well || []),
    ...(stateColumns.improve || []),
    ...(stateColumns.continue || stateColumns.action || [])
  ];
  const totalVotes = cards.reduce((sum, card) => sum + (card.votes || 0), 0);

  return {
    counts,
    totalNotes: cards.length,
    totalVotes,
    actions: actionItems.length
  };
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function renderHealth(state) {
  const stats = getRetroStats(state);
  const hasEveryColumn =
    stats.counts.well > 0 &&
    stats.counts.improve > 0 &&
    stats.counts.continue > 0;
  const hasVotes = stats.totalVotes >= 3;
  const readyToDiscuss = hasEveryColumn && hasVotes;

  setText(healthStats.notes, String(stats.totalNotes));
  setText(healthStats.votes, String(stats.totalVotes));
  setText(healthStats.actions, String(stats.actions));
  setText(healthStats.online, String(onlineUsers));
  setText(healthStats.start, String(stats.counts.well));
  setText(healthStats.stop, String(stats.counts.improve));
  setText(healthStats.continueNotes, String(stats.counts.continue));
  setText(healthStats.healthVotes, String(stats.totalVotes));

  if (healthStats.status) {
    healthStats.status.classList.toggle("is-ready", readyToDiscuss);
    healthStats.status.textContent = readyToDiscuss
      ? "Ready to discuss"
      : "Collecting input";
  }

  if (healthStats.statusDetail) {
    if (readyToDiscuss) {
      healthStats.statusDetail.textContent =
        "There is input across the board and enough voting signal to focus the discussion.";
    } else if (!hasEveryColumn) {
      healthStats.statusDetail.textContent =
        "Add at least one note to Start, Stop, and Continue.";
    } else {
      healthStats.statusDetail.textContent =
        "Gather at least three votes to identify the strongest discussion points.";
    }
  }
}

function renderState(state) {
  const actionSourceIds = new Set(
    (state.actions || []).map((action) => action.sourceCardId).filter(Boolean)
  );
  Object.keys(columns).forEach((key) => {
    columns[key].innerHTML = "";
    const cards =
      state.columns[key] || (key === "continue" ? state.columns.action || [] : []);
    const sortedCards = [...cards].sort((a, b) => {
      return (b.votes || 0) - (a.votes || 0);
    });
    if (columnCounts[key]) {
      columnCounts[key].textContent = String(sortedCards.length);
    }
    sortedCards.forEach((card) => {
      const li = document.createElement("li");
      li.className = "card";
      li.dataset.id = card.id;
      li.dataset.text = card.text;
      li.dataset.votes = String(card.votes || 0);
      li.dataset.details = card.details || "";
      const menu = document.createElement("span");
      menu.className = "card-menu";
      menu.setAttribute("aria-hidden", "true");
      menu.textContent = "⋮";
      const strong = document.createElement("strong");
      strong.textContent = card.text;
      const header = document.createElement("div");
      header.className = "card-main";
      header.appendChild(strong);
      header.appendChild(menu);
      li.appendChild(header);
      if (card.details) {
        const details = document.createElement("p");
        details.className = "card-details";
        details.textContent = card.details;
        li.appendChild(details);
      }
      const footer = document.createElement("div");
      footer.className = "card-footer";
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = getCardInitials(card);
      const votes = document.createElement("span");
      votes.className = "vote-count";
      votes.textContent = String(card.votes || 0);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vote-btn";
      button.textContent = "+1";
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "create-action-btn";
      actionButton.textContent = actionSourceIds.has(card.id)
        ? "Action created"
        : "Create action";
      actionButton.disabled = actionSourceIds.has(card.id);
      actionButton.setAttribute(
        "aria-label",
        actionSourceIds.has(card.id)
          ? `Action already created for ${card.text}`
          : `Create action for ${card.text}`
      );
      const cardControls = document.createElement("div");
      cardControls.className = "card-controls";
      footer.appendChild(avatar);
      button.appendChild(votes);
      cardControls.appendChild(actionButton);
      cardControls.appendChild(button);
      footer.appendChild(cardControls);
      li.appendChild(footer);
      columns[key].appendChild(li);
    });
  });

  if (state.lastAction && state.lastAction.user) {
    activityEl.textContent = `${state.lastAction.user} ${state.lastAction.action}`;
  }
  renderHealth(state);
}

function renderParticipants(users) {
  if (!participantList) {
    return;
  }
  participantList.innerHTML = "";
  users.slice(0, 8).forEach((user) => {
    const item = document.createElement("span");
    item.className = "avatar participant-avatar";
    item.title = user;
    item.textContent = getInitials(user);
    participantList.appendChild(item);
  });
  if (users.length > 8) {
    const more = document.createElement("span");
    more.className = "avatar participant-avatar muted";
    more.textContent = `+${users.length - 8}`;
    participantList.appendChild(more);
  }
}

function sendMessage(payload) {
  if (!socket || socket.readyState !== 1) {
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function closeActionDialog() {
  if (actionDialog && actionDialog.open) {
    actionDialog.close();
  }
}

function openActionDialog(cardEl) {
  if (
    !actionDialog ||
    !actionCardIdInput ||
    !actionTitleInput ||
    !actionOwnerInput ||
    !actionDueDateInput ||
    !actionNotesInput
  ) {
    return;
  }
  actionCardIdInput.value = cardEl.dataset.id || "";
  actionTitleInput.value = cardEl.dataset.text || "";
  actionOwnerInput.value = username || "";
  actionDueDateInput.value = "";
  actionNotesInput.value = cardEl.dataset.details || "";
  if (typeof actionDialog.showModal === "function") {
    actionDialog.showModal();
  } else {
    actionDialog.setAttribute("open", "");
  }
  actionTitleInput.focus();
  actionTitleInput.select();
}

function getColumnKey(listEl) {
  return Object.keys(columns).find((key) => columns[key] === listEl) || "";
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(remainingSeconds);
}

function getTimerMinutesInputValue() {
  const parsed = Number.parseInt(timerMinutesInput.value || "1", 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, parsed);
}

function ensureAudioContext() {
  const AudioConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioConstructor) {
    return;
  }
  if (!audioContext) {
    audioContext = new AudioConstructor();
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
  const value = getTimerMinutesInputValue() + 1;
  timerMinutesInput.value = String(value);
  sendMessage({ type: "timer", action: "set", minutes: value });
});

timerDec.addEventListener("click", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  const value = getTimerMinutesInputValue() - 1;
  const minutes = Math.max(1, value);
  timerMinutesInput.value = String(minutes);
  sendMessage({ type: "timer", action: "set", minutes });
});

timerMinutesInput.addEventListener("change", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  const minutes = getTimerMinutesInputValue();
  timerMinutesInput.value = String(minutes);
  sendMessage({ type: "timer", action: "set", minutes });
});

timerStart.addEventListener("click", () => {
  if (!isFacilitator || isReadOnly) {
    return;
  }
  ensureAudioContext();
  const minutes = getTimerMinutesInputValue();
  timerMinutesInput.value = String(minutes);
  sendMessage({ type: "timer", action: "start", minutes });
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
    timerControls.hidden = !isFacilitator || isReadOnly;
  }
}

if (timerControls) {
  timerControls.hidden = true;
}

const drake = dragula([columns.well, columns.improve, columns.continue], {
  moves: () => !isReadOnly
});

const handleDragUpdate = (el, target, source, sibling) => {
  if (!target || target === source) {
    renderState(currentState);
    return;
  }
  const targetColumn = getColumnKey(target);
  if (!targetColumn) {
    renderState(currentState);
    return;
  }
  const didSend = sendMessage({
    type: "moveCard",
    cardId: el.dataset.id,
    targetColumn,
    beforeCardId: sibling ? sibling.dataset.id : null
  });
  if (!didSend) {
    renderState(currentState);
  }
};

drake.on("drop", handleDragUpdate);

Object.values(columns).forEach((listEl) => {
  listEl.addEventListener("click", (event) => {
    if (isReadOnly) {
      return;
    }
    const actionButton = event.target.closest(".create-action-btn");
    if (actionButton && !actionButton.disabled) {
      const cardEl = actionButton.closest(".card");
      if (!cardEl) {
        return;
      }
      openActionDialog(cardEl);
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
    sendMessage({
      type: "voteCard",
      cardId: cardEl.dataset.id
    });
  });
});

if (actionCancel) {
  actionCancel.addEventListener("click", closeActionDialog);
}

if (actionDismiss) {
  actionDismiss.addEventListener("click", closeActionDialog);
}

if (actionDialog) {
  actionDialog.addEventListener("click", (event) => {
    if (event.target === actionDialog) {
      closeActionDialog();
    }
  });
}

if (actionForm) {
  actionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isReadOnly) {
      return;
    }
    const title = actionTitleInput.value.trim();
    if (!title) {
      actionTitleInput.focus();
      return;
    }
    const didSend = sendMessage({
      type: "createAction",
      cardId: actionCardIdInput.value,
      title,
      owner: actionOwnerInput.value.trim(),
      dueDate: actionDueDateInput.value,
      notes: actionNotesInput.value.trim()
    });
    if (didSend) {
      closeActionDialog();
    }
  });
}

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
  const didSend = sendMessage({
    type: "addCard",
    column: columnSelect.value,
    text,
    details
  });
  if (!didSend) {
    return;
  }

  textInput.value = "";
  detailsInput.value = "";
  textInput.focus();
});

async function loadRetroMeta() {
  const response = await fetchWithAuth(
    `/api/retros/${encodeURIComponent(retroId)}`
  );
  if (handleUnauthorized(response)) {
    return;
  }
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
  const query = new URLSearchParams({ retroId });
  socket = new WebSocket(
    `${socketProtocol}://${location.host}?${query.toString()}`
  );

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
    if (data.type === "error") {
      if (data.message === "Unauthorized.") {
        localStorage.removeItem("retroUserName");
        localStorage.removeItem("retroUserRole");
        localStorage.removeItem("retroUserTeam");
        window.location.href = "/";
      } else {
        window.location.href = "/lobby";
      }
      return;
    }
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
      onlineUsers = users.length;
      presenceEl.textContent = `${users.length} online`;
      renderParticipants(users);
      renderHealth(currentState);
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
  username = data.user.name || "Anonymous";
  userRole = data.user.role || "participant";
  userTeam = data.user.team || "";
  isFacilitator = userRole === "facilitator";
  applyReadOnlyState();
  localStorage.setItem("retroUserName", username);
  localStorage.setItem("retroUserRole", userRole);
  localStorage.setItem("retroUserTeam", userTeam);
  return data.user;
}

async function init() {
  const session = await loadSession();
  if (!session) {
    return;
  }
  await loadRetroMeta();
  connectSocket();
}

init();
