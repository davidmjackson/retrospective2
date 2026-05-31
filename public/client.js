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
const timerCompleteSound = document.getElementById("timer-complete-sound");
const actionDialog = document.getElementById("action-dialog");
const actionForm = document.getElementById("action-form");
const actionCardIdInput = document.getElementById("action-card-id");
const actionTitleInput = document.getElementById("action-title");
const actionOwnerInput = document.getElementById("action-owner");
const actionDueDateInput = document.getElementById("action-due-date");
const actionNotesInput = document.getElementById("action-notes");
const actionCancel = document.getElementById("action-cancel");
const actionDismiss = document.getElementById("action-dismiss");
const instructionsButton = document.getElementById("show-instructions");
const instructionsDialog = document.getElementById("instructions-dialog");
const instructionsClose = document.getElementById("instructions-close");
const instructionsDismiss = document.getElementById("instructions-dismiss");
const noteDialog = document.getElementById("note-dialog");
const noteForm = document.getElementById("note-form");
const noteText = document.getElementById("note-text");
const noteDetails = document.getElementById("note-details");
const noteColumnInput = document.getElementById("note-column");
const noteColumnLabel = document.getElementById("note-column-label");
const noteClose = document.getElementById("note-close");
const columnAddButtons = document.querySelectorAll(".column-add");
const instructionBanner = document.querySelector(".instruction-banner");
const instructionBannerDismiss = document.getElementById(
  "instruction-banner-dismiss"
);
const tipsBar = document.querySelector(".tips-bar");
const tipsDismiss = document.getElementById("tips-dismiss");
const healthStats = {
  notes: document.getElementById("stat-notes"),
  votes: document.getElementById("stat-votes"),
  actions: document.getElementById("stat-actions"),
  online: document.getElementById("stat-online"),
  status: document.getElementById("health-status"),
  statusDetail: document.getElementById("health-status-detail")
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
const retroId = params.get("retroId");

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
let timerSoundUnlocked = false;
let socket = null;
let onlineUsers = 0;

/**
 * Pick a pin colour for a note. Hash on the note id so the same note
 * always has the same colour — feels stable on re-render.
 */
function pinColorFor(note) {
  const palette = ["red", "blue", "yellow", "green"];
  const seed = String(note.id || note.text || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

// Track card IDs that should receive the pin-up animation on next render.
let freshCardIds = new Set();

if (!retroId) {
  window.location.href = "/lobby";
}

function handleUnauthorized(response) {
  if (response.status === 401 || response.status === 403) {
    window.location.reload();
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
      li.className = "card polaroid";
      li.dataset.id = card.id;
      li.dataset.text = card.text;
      li.dataset.votes = String(card.votes || 0);
      li.dataset.details = card.details || "";

      // Pin head
      const pin = document.createElement("div");
      pin.className = `pin pin-${pinColorFor(card)}`;
      li.appendChild(pin);

      // Polaroid body (card text)
      const body = document.createElement("div");
      body.className = "polaroid-body";
      const strong = document.createElement("strong");
      strong.textContent = card.text;
      body.appendChild(strong);
      if (card.details) {
        const details = document.createElement("p");
        details.className = "card-details";
        details.textContent = card.details;
        body.appendChild(details);
      }
      li.appendChild(body);

      // Polaroid footer (author initials, votes, controls)
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
      button.setAttribute("aria-label", `Vote for ${card.text}`);
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

      // Pin-up animation for freshly-added notes
      if (freshCardIds.has(card.id)) {
        li.classList.add("fresh");
        li.addEventListener("animationend", () => li.classList.remove("fresh"), { once: true });
      }

      columns[key].appendChild(li);
    });
  });
  freshCardIds.clear();

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

function closeInstructionsDialog() {
  if (instructionsDialog && instructionsDialog.open) {
    instructionsDialog.close();
  }
}

function openInstructionsDialog() {
  if (!instructionsDialog) {
    return;
  }
  if (typeof instructionsDialog.showModal === "function") {
    instructionsDialog.showModal();
  } else {
    instructionsDialog.setAttribute("open", "");
  }
  if (instructionsClose) {
    instructionsClose.focus();
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

function unlockTimerSound() {
  if (!timerCompleteSound || timerSoundUnlocked) {
    return;
  }
  const previousVolume = timerCompleteSound.volume;
  timerCompleteSound.volume = 0;
  timerCompleteSound.currentTime = 0;
  const playAttempt = timerCompleteSound.play();
  if (playAttempt && typeof playAttempt.then === "function") {
    playAttempt
      .then(() => {
        timerCompleteSound.pause();
        timerCompleteSound.currentTime = 0;
        timerCompleteSound.volume = previousVolume || 1;
        timerSoundUnlocked = true;
      })
      .catch(() => {
        timerCompleteSound.volume = previousVolume || 1;
      });
  } else {
    timerCompleteSound.pause();
    timerCompleteSound.currentTime = 0;
    timerCompleteSound.volume = previousVolume || 1;
    timerSoundUnlocked = true;
  }
}

function playTimerSound() {
  if (!timerCompleteSound) {
    return;
  }
  timerCompleteSound.pause();
  timerCompleteSound.currentTime = 0;
  timerCompleteSound.volume = 1;
  const playAttempt = timerCompleteSound.play();
  if (playAttempt && typeof playAttempt.catch === "function") {
    playAttempt.catch(() => {});
  }
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
  unlockTimerSound();
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
document.addEventListener("click", unlockTimerSound, { once: true });

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

if (instructionsButton) {
  instructionsButton.addEventListener("click", openInstructionsDialog);
}

if (instructionsClose) {
  instructionsClose.addEventListener("click", closeInstructionsDialog);
}

if (instructionsDismiss) {
  instructionsDismiss.addEventListener("click", closeInstructionsDialog);
}

if (instructionsDialog) {
  instructionsDialog.addEventListener("click", (event) => {
    if (event.target === instructionsDialog) {
      closeInstructionsDialog();
    }
  });
}

function setupDismissible(element, dismissButton, storageKey) {
  if (!element || !dismissButton) {
    return;
  }
  if (localStorage.getItem(storageKey) === "1") {
    element.hidden = true;
  }
  dismissButton.addEventListener("click", () => {
    element.hidden = true;
    localStorage.setItem(storageKey, "1");
  });
}

setupDismissible(
  instructionBanner,
  instructionBannerDismiss,
  "retroHideInstructionBanner"
);
setupDismissible(tipsBar, tipsDismiss, "retroHideTips");

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

function closeNoteDialog() {
  if (noteDialog && noteDialog.open) {
    noteDialog.close();
  }
}

function openNoteDialog(column) {
  if (!noteDialog || !noteText || !noteDetails || !noteColumnInput) {
    return;
  }
  if (isReadOnly || !columns[column]) {
    return;
  }
  noteColumnInput.value = column;
  if (noteColumnLabel) {
    noteColumnLabel.textContent = columnLabels[column] || column;
  }
  noteText.value = "";
  noteDetails.value = "";
  if (typeof noteDialog.showModal === "function") {
    noteDialog.showModal();
  } else {
    noteDialog.setAttribute("open", "");
  }
  noteText.focus();
}

columnAddButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openNoteDialog(button.dataset.column);
  });
});

if (noteClose) {
  noteClose.addEventListener("click", closeNoteDialog);
}

if (noteDialog) {
  noteDialog.addEventListener("click", (event) => {
    if (event.target === noteDialog) {
      closeNoteDialog();
    }
  });
}

if (noteForm) {
  noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isReadOnly) {
      return;
    }
    const text = noteText.value.trim();
    const details = noteDetails.value.trim();
    if (!text) {
      noteText.focus();
      return;
    }
    const didSend = sendMessage({
      type: "addCard",
      column: noteColumnInput.value,
      text,
      details
    });
    if (didSend) {
      closeNoteDialog();
    }
  });
}

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
  retroMeta.textContent = new Date(retro.createdAt).toLocaleString();
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
  const query = new URLSearchParams({
    retroId,
    name: username || "Anonymous",
    role: userRole
  });
  socket = new WebSocket(
    `${socketProtocol}://${location.host}/ws?${query.toString()}`
  );

  socket.addEventListener("open", () => {
    statusEl.textContent = "Live";
    statusEl.classList.add("online");
    socket.send(JSON.stringify({ type: "hello", user: username }));
  });

  socket.addEventListener("close", (event) => {
    statusEl.textContent = "Offline";
    statusEl.classList.remove("online");
    if (event.code === 4401 || event.code === 1008) {
      window.location.reload();
    }
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "error") {
      window.location.href = "/lobby";
      return;
    }
    if (data.type === "init" || data.type === "update") {
      if (data.type === "update") {
        // Detect genuinely new cards by comparing incoming state to current state.
        const prevIds = new Set(
          [
            ...(currentState.columns.well || []),
            ...(currentState.columns.improve || []),
            ...(currentState.columns.continue || currentState.columns.action || [])
          ].map((c) => c.id)
        );
        const newRetroColumns = data.retro.columns || {};
        [
          ...(newRetroColumns.well || []),
          ...(newRetroColumns.improve || []),
          ...(newRetroColumns.continue || newRetroColumns.action || [])
        ].forEach((c) => {
          if (!prevIds.has(c.id)) {
            freshCardIds.add(c.id);
          }
        });
      }
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
      if (data.retro) {
        currentState = data.retro;
      }
      isReadOnly = true;
      retroStatus.textContent = data.retro?.closedAt
        ? `Closed · ${new Date(data.retro.closedAt).toLocaleDateString()}`
        : "Closed";
      retroStatus.classList.remove("open");
      retroStatus.classList.add("closed");
      applyReadOnlyState();
    }
  });
}

function loadSession() {
  username = localStorage.getItem("retroUserName") || "Anonymous";
  userRole =
    localStorage.getItem("retroUserRole") === "facilitator"
      ? "facilitator"
      : "participant";
  isFacilitator = userRole === "facilitator";
  applyReadOnlyState();
  return { name: username, role: userRole };
}

async function init() {
  loadSession();
  await loadRetroMeta();
  connectSocket();
}

init();
