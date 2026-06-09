const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { logger } = require("./lib/logger");
const { makeRequestLogger } = require("./middleware/requestLogger");
const { makeErrorHandler } = require("./middleware/errorHandler");
const {
  normalizeRetro,
  openDatabase,
  ensureSchema,
  loadRetros,
  saveRetro,
  saveRetroCard,
  saveRetroAction,
  saveRetroTimer,
  saveRetros,
  seedFromJsonIfPresent,
  applyRetention
} = require("./db");
const { createAuthClient } = require("@suite/auth-client");
const { decideUpgrade } = require("./lib/upgradeAuth");
const { boardCompanyAllowed } = require("./lib/companyAccess");
const { validateMessage } = require("./schemas/ws");
const { createRetroSchema, updateActionSchema } = require("./schemas/api");

const app = express();
app.use(makeRequestLogger(logger));
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

const auth = createAuthClient({
  appName: process.env.APP_NAME || "retro",
  hubBaseUrl: process.env.HUB_BASE_URL,
  hubApiKey: process.env.HUB_API_KEY,
  cookieName: "retro_session",
  cookieDomain: process.env.COOKIE_DOMAIN,
  dbPath: process.env.APP_SESSIONS_DB || path.join(__dirname, "data", "retro-sessions.db")
});

server.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  const rawUrl = String(req.url || "");
  if (rawUrl !== "/ws" && !rawUrl.startsWith("/ws?")) {
    socket.destroy();
    return;
  }
  const parsed = new URL(rawUrl, `http://${req.headers.host}`);
  const shareToken = parsed.searchParams.get("token");
  let result;
  try {
    result = await decideUpgrade(
      auth.verifySession,
      req.headers.cookie,
      shareToken,
      lookupOpenBoardByToken
    );
  } catch (err) {
    console.warn("WS upgrade auth error:", err);
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!result.ok) {
    socket.write(`HTTP/1.1 ${result.status} Unauthorized\r\n\r\n`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (result.anonymous) {
      ws.anonymous = true;
      ws.company = null;
      ws.anonRetroId = result.boardId;
    } else {
      ws.anonymous = false;
      ws.hubUserId = result.context.userId;
      ws.company = result.context.company || null;
    }
    wss.emit("connection", ws, req);
  });
});

const clients = new Map();
const rooms = new Map();
const lobbyRooms = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const stateFile = path.join(__dirname, "state.json");
const dbFile = process.env.RETRO_DB_PATH || path.join(__dirname, "retros.db");
const db = openDatabase(dbFile);

function createRetro({ title, companyId }) {
  return normalizeRetro({
    id: `retro-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    companyId,
    shareToken: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
    closed: false,
    closedAt: null,
    columns: {
      well: [],
      improve: [],
      continue: []
    },
    actions: [],
    timer: null,
    lastAction: null
  });
}

let state = { retros: [] };

function initializeState(callback) {
  ensureSchema(db, (err) => {
    if (err) {
      logger.warn({ err }, "Failed to initialize database.");
      callback();
      return;
    }
    loadRetros(db, (loadErr, retros) => {
      if (loadErr) {
        logger.warn({ err: loadErr }, "Failed to load retros from database.");
        callback();
        return;
      }
      if (retros.length) {
        state.retros = retros;
        callback();
        return;
      }
      seedFromJsonIfPresent(db, stateFile, (seedErr, seededRetros) => {
        if (seedErr) {
          logger.warn({ err: seedErr }, "Failed to seed from state.json.");
          callback();
          return;
        }
        if (seededRetros && seededRetros.length) {
          state.retros = seededRetros;
        }
        callback();
      });
    });
  });
}

function saveState() {
  saveRetros(db, state.retros, (err) => {
    if (err) {
      logger.warn({ err }, "Failed to persist retros.");
    }
  });
}

function persistRetro(retro) {
  let didSave = true;
  saveRetro(db, retro, (err) => {
    if (err) {
      didSave = false;
      logger.warn({ err }, "Failed to persist retro.");
    }
  });
  return didSave;
}

function persistRetroTimer(retro) {
  let didSave = true;
  saveRetroTimer(db, retro, (err) => {
    if (err) {
      didSave = false;
      logger.warn({ err }, "Failed to persist retro timer.");
    }
  });
  return didSave;
}

function persistRetroCard(retro, columnType, card) {
  let didSave = true;
  saveRetroCard(db, retro, columnType, card, (err) => {
    if (err) {
      didSave = false;
      logger.warn({ err }, "Failed to persist retro card.");
    }
  });
  return didSave;
}

function persistRetroAction(retro, action) {
  let didSave = true;
  saveRetroAction(db, retro, action, (err) => {
    if (err) {
      didSave = false;
      logger.warn({ err }, "Failed to persist retro action.");
    }
  });
  return didSave;
}

const allowedActionStatuses = new Set(["todo", "in_progress", "blocked", "done"]);
const maxRetroTitleLength = 140;
const maxCardTextLength = 500;
const maxCardDetailsLength = 2000;
const maxActionNotesLength = 4000;
const maxActionOwnerLength = 80;
const maxActionDueDateLength = 10;
const maxTimerMinutes = 240;
const maxCardsPerColumn = 100;
const allowedOrigins = (process.env.RETRO_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch (err) {
    return "";
  }
}

function getAllowedSameHostOrigins(headers) {
  const host = headers.host;
  if (typeof host !== "string" || !host.trim()) {
    return new Set();
  }
  const forwardedProto =
    typeof headers["x-forwarded-proto"] === "string"
      ? headers["x-forwarded-proto"].split(",")[0].trim()
      : "";
  const proto = forwardedProto || "http";
  return new Set([`${proto}://${host}`, `http://${host}`, `https://${host}`]);
}

function isWebSocketOriginAllowed(headers) {
  const origin = normalizeOrigin(headers.origin);
  if (!origin) {
    return true;
  }
  if (allowedOrigins.includes("*")) {
    return true;
  }
  if (allowedOrigins.length) {
    return allowedOrigins.includes(origin);
  }
  return getAllowedSameHostOrigins(headers).has(origin);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateText(value, field, maxLength, options = {}) {
  const required = Boolean(options.required);
  if (value === undefined || value === null) {
    if (required) {
      return { error: `${field} is required.` };
    }
    return { value: "" };
  }
  if (typeof value !== "string") {
    return { error: `${field} must be text.` };
  }
  const text = value.trim();
  if (required && !text) {
    return { error: `${field} is required.` };
  }
  if (text.length > maxLength) {
    return { error: `${field} must be ${maxLength} characters or fewer.` };
  }
  return { value: text };
}

function validateId(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    return { error: `${field} is required.` };
  }
  const id = value.trim();
  if (id.length > 160 || !/^[a-zA-Z0-9._:-]+$/.test(id)) {
    return { error: `${field} is invalid.` };
  }
  return { value: id };
}

function validateVotes(value) {
  let votes;
  if (Number.isInteger(value)) {
    votes = value;
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    votes = Number.parseInt(value.trim(), 10);
  } else {
    return { error: "Votes must be a number between 0 and 100000." };
  }
  if (!Number.isFinite(votes) || votes < 0 || votes > 100000) {
    return { error: "Votes must be a number between 0 and 100000." };
  }
  return { value: votes };
}

function validateActionStatus(value) {
  if (typeof value !== "string" || !allowedActionStatuses.has(value)) {
    return { error: "Status must be one of: todo, in_progress, blocked, done." };
  }
  return { value };
}

function validateDueDate(value) {
  if (value === undefined || value === null || value === "") {
    return { value: "" };
  }
  const date = validateText(value, "Due date", maxActionDueDateLength);
  if (date.error) {
    return date;
  }
  if (date.value && !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
    return { error: "Due date must use YYYY-MM-DD format." };
  }
  return date;
}

function validateTimerMinutes(value) {
  if (!Number.isFinite(value)) {
    return { error: "Timer minutes must be a number." };
  }
  const minutes = Math.floor(value);
  if (minutes < 1 || minutes > maxTimerMinutes) {
    return { error: `Timer minutes must be between 1 and ${maxTimerMinutes}.` };
  }
  return { value: minutes };
}

function validateColumnName(value, field = "Column") {
  if (typeof value !== "string") {
    return { error: `${field} is invalid.` };
  }
  const normalized = value === "action" ? "continue" : value;
  if (!["well", "improve", "continue"].includes(normalized)) {
    return { error: `${field} is invalid.` };
  }
  return { value: normalized };
}

function createCardId() {
  if (typeof crypto.randomUUID === "function") {
    return `card-${crypto.randomUUID()}`;
  }
  return `card-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function createActionId() {
  if (typeof crypto.randomUUID === "function") {
    return `action-${crypto.randomUUID()}`;
  }
  return `action-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function setLastAction(retro, user, action) {
  retro.lastAction = {
    user: user || "Anonymous",
    action
  };
}

function findCardLocation(retro, cardId) {
  for (const column of ["well", "improve", "continue"]) {
    const index = retro.columns[column].findIndex((card) => card.id === cardId);
    if (index !== -1) {
      return { column, index, card: retro.columns[column][index] };
    }
  }
  return null;
}

function addCardToRetro(retro, data, auth) {
  const column = validateColumnName(data.column);
  if (column.error) {
    return column;
  }
  if (retro.columns[column.value].length >= maxCardsPerColumn) {
    return {
      error: `${column.value} column cannot contain more than ${maxCardsPerColumn} cards.`
    };
  }
  const text = validateText(data.text, "Card text", maxCardTextLength, {
    required: true
  });
  if (text.error) {
    return text;
  }
  const details = validateText(data.details, "Card details", maxCardDetailsLength);
  if (details.error) {
    return details;
  }

  const card = {
    id: createCardId(),
    text: text.value,
    details: details.value,
    votes: 0,
    createdBy: auth.name || "Anonymous"
  };
  retro.columns[column.value].push(card);
  setLastAction(retro, auth.name, "added a card");
  return { value: { card, columnType: column.value } };
}

function voteCardInRetro(retro, data, auth) {
  const cardId = validateId(data.cardId, "Card id");
  if (cardId.error) {
    return cardId;
  }
  const location = findCardLocation(retro, cardId.value);
  if (!location) {
    return { error: "Card not found." };
  }
  const votes = validateVotes(location.card.votes + 1);
  if (votes.error) {
    return votes;
  }
  location.card.votes = votes.value;
  setLastAction(retro, auth.name, "added a vote");
  return { value: { card: location.card, columnType: location.column } };
}

function moveCardInRetro(retro, data, auth) {
  const cardId = validateId(data.cardId, "Card id");
  if (cardId.error) {
    return cardId;
  }
  const targetColumn = validateColumnName(data.targetColumn, "Target column");
  if (targetColumn.error) {
    return targetColumn;
  }
  let beforeCardId = null;
  if (data.beforeCardId !== undefined && data.beforeCardId !== null) {
    const validatedBeforeCardId = validateId(data.beforeCardId, "Before card id");
    if (validatedBeforeCardId.error) {
      return validatedBeforeCardId;
    }
    beforeCardId = validatedBeforeCardId.value;
  }

  const location = findCardLocation(retro, cardId.value);
  if (!location) {
    return { error: "Card not found." };
  }
  if (
    location.column !== targetColumn.value &&
    retro.columns[targetColumn.value].length >= maxCardsPerColumn
  ) {
    return {
      error: `${targetColumn.value} column cannot contain more than ${maxCardsPerColumn} cards.`
    };
  }

  const [card] = retro.columns[location.column].splice(location.index, 1);
  delete card.status;
  delete card.notes;

  const targetList = retro.columns[targetColumn.value];
  const beforeIndex = beforeCardId
    ? targetList.findIndex((item) => item.id === beforeCardId)
    : -1;
  if (beforeIndex === -1) {
    targetList.push(card);
  } else {
    targetList.splice(beforeIndex, 0, card);
  }
  setLastAction(retro, auth.name, "moved a card");
  return { value: { card, columnType: targetColumn.value } };
}

function createActionFromCard(retro, data, auth) {
  const cardId = validateId(data.cardId, "Card id");
  if (cardId.error) {
    return cardId;
  }
  const location = findCardLocation(retro, cardId.value);
  if (!location) {
    return { error: "Card not found." };
  }
  const existing = (retro.actions || []).find(
    (action) => action.sourceCardId === location.card.id
  );
  if (existing) {
    return { value: { action: existing, created: false } };
  }
  const title = validateText(data.title, "Action title", maxCardTextLength);
  if (title.error) {
    return title;
  }
  const owner = validateText(data.owner, "Action owner", maxActionOwnerLength);
  if (owner.error) {
    return owner;
  }
  const dueDate = validateDueDate(data.dueDate);
  if (dueDate.error) {
    return dueDate;
  }
  const notes = validateText(data.notes, "Action notes", maxActionNotesLength);
  if (notes.error) {
    return notes;
  }

  const action = {
    id: createActionId(),
    sourceCardId: location.card.id,
    text: title.value || location.card.text,
    details: location.card.details || "",
    owner: owner.value || auth.name || "Anonymous",
    dueDate: dueDate.value,
    status: "todo",
    notes: notes.value,
    createdAt: new Date().toISOString(),
    createdBy: auth.name || "Anonymous"
  };
  retro.actions = retro.actions || [];
  retro.actions.push(action);
  setLastAction(retro, auth.name, "created an action");
  return { value: { action, created: true } };
}

function persistCardAndBroadcastRetro(retro, mutation) {
  if (!persistRetroCard(retro, mutation.columnType, mutation.card)) {
    return;
  }
  broadcastToRetro(retro.id, { type: "update", retro });
}

function persistActionAndBroadcastRetro(retro, mutation) {
  if (!persistRetroAction(retro, mutation.action)) {
    return;
  }
  broadcastToRetro(retro.id, { type: "update", retro });
}

function ensureBoardAccess(req, res, retro) {
  if (!retro || !boardCompanyAllowed(retro, req.user.company)) {
    res.status(404).json({ error: "Retro not found." });
    return false;
  }
  return true;
}

function reconcileTimers() {
  state.retros.forEach((retro) => {
    if (retro.timer.running && retro.timer.endAt) {
      const remaining = Math.ceil((retro.timer.endAt - Date.now()) / 1000);
      if (remaining <= 0) {
        retro.timer.remainingSeconds = 0;
        retro.timer.running = false;
        retro.timer.endAt = null;
      } else {
        retro.timer.remainingSeconds = remaining;
      }
    }
  });
}

const retentionDays = Number.parseInt(
  process.env.RETRO_RETENTION_DAYS || "",
  10
);

function runRetentionIfConfigured() {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return;
  }
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const removedIds = state.retros
    .filter((retro) => retro.closed && retro.closedAt && retro.closedAt < cutoff)
    .map((retro) => retro.id);
  if (!removedIds.length) {
    return;
  }
  applyRetention(db, retentionDays, (err) => {
    if (err) {
      logger.warn({ err }, "Failed to apply retention policy.");
      return;
    }
    state.retros = state.retros.filter((retro) => !removedIds.includes(retro.id));
  });
}

function getRetro(id) {
  return state.retros.find((retro) => retro.id === id);
}

function listRetrosForCompany(companyId) {
  return state.retros
    .filter((retro) => retro.companyId === companyId)
    .map((retro) => ({
      id: retro.id,
      title: retro.title,
      companyId: retro.companyId,
      createdAt: retro.createdAt,
      closed: retro.closed,
      closedAt: retro.closedAt
    }));
}

function findBoardByToken(token) {
  if (!token) return null;
  return state.retros.find((retro) => retro.shareToken === token) || null;
}

function lookupOpenBoardByToken(token) {
  const retro = findBoardByToken(token);
  return retro ? { id: retro.id, closed: retro.closed } : null;
}

function listPresence(retroId) {
  return Array.from(clients.values())
    .filter((client) => client.retroId === retroId)
    .map((client) => client.name);
}

function broadcastToRetro(retroId, payload) {
  const message = JSON.stringify(payload);
  const room = rooms.get(retroId);
  if (!room) {
    return;
  }
  for (const client of room) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function joinLobbyRoom(teamName, ws) {
  if (!lobbyRooms.has(teamName)) {
    lobbyRooms.set(teamName, new Set());
  }
  lobbyRooms.get(teamName).add(ws);
}

function leaveLobbyRoom(teamName, ws) {
  const room = lobbyRooms.get(teamName);
  if (!room) {
    return;
  }
  room.delete(ws);
  if (room.size === 0) {
    lobbyRooms.delete(teamName);
  }
}

function broadcastToLobby(teamName, payload) {
  const message = JSON.stringify(payload);
  const room = lobbyRooms.get(teamName);
  if (!room) {
    return;
  }
  for (const client of room) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function broadcastRetrosToLobby(companyId) {
  broadcastToLobby(companyId, {
    type: "retros",
    retros: listRetrosForCompany(companyId)
  });
}


function joinRoom(retroId, ws) {
  if (!rooms.has(retroId)) {
    rooms.set(retroId, new Set());
  }
  rooms.get(retroId).add(ws);
}

function leaveRoom(retroId, ws) {
  const room = rooms.get(retroId);
  if (!room) {
    return;
  }
  room.delete(ws);
  if (room.size === 0) {
    rooms.delete(retroId);
  }
}

// Auth hub integration
app.use("/auth-client", auth.staticAssets);
app.get("/auth/launch", auth.handleLaunch);
app.get("/auth/logout", auth.handleLogout);
app.get("/auth/whoami", auth.handleWhoami);
app.post("/api/heartbeat", auth.handleHeartbeat);

function requireEntitled(req, res, next) {
  if (req.user && req.user.entitled) return next();
  return res.redirect(302, `${auth._ctx.hubBaseUrl}/dashboard`);
}

app.get("/", auth.requireAuth, requireEntitled, (req, res) => {
  res.redirect(302, "/lobby");
});

app.get("/lobby", auth.requireAuth, requireEntitled, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "lobby.html"));
});

app.get("/retrospective", auth.requireAuth, requireEntitled, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "retrospective.html"));
});

app.get("/retro", (req, res) => res.redirect(302, "/retrospective"));

app.get("/actions", auth.requireAuth, requireEntitled, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "actions.html"));
});

app.get("/license", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "license.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) });
});

// --- Public anonymous-share surface (no auth) ---
app.get("/api/shared/:token", (req, res) => {
  const retro = findBoardByToken(String(req.params.token || ""));
  if (!retro) {
    res.status(404).json({ error: "This link is not valid." });
    return;
  }
  if (retro.closed) {
    res.status(410).json({ error: "This retro has ended." });
    return;
  }
  res.json({ board: { id: retro.id, title: retro.title, closed: retro.closed } });
});

app.get("/join", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "join.html"));
});

app.get("/shared", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "retrospective.html"));
});

app.get("/api/me", auth.requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id }, company: req.user.company || null });
});

// Static: never serve *.html directly (pages are route-gated above). Serve the
// asset folders + top-level client scripts only.
app.use((req, res, next) => {
  if (req.path.toLowerCase().endsWith(".html")) return res.status(404).end();
  next();
});
["css", "fonts", "illos", "sounds", "vendor"].forEach((dir) => {
  app.use(`/${dir}`, express.static(path.join(__dirname, "public", dir)));
});
app.use(express.static(path.join(__dirname, "public"), { index: false, extensions: [] }));

app.get("/api/retros", auth.requireAuth, requireEntitled, (req, res) => {
  const company = req.user.company;
  if (!company || !company.id) {
    res.status(403).json({ error: "No company on your account. Please sign in again." });
    return;
  }
  res.json({ retros: listRetrosForCompany(company.id) });
});

app.post("/api/retros", auth.requireAuth, requireEntitled, (req, res) => {
  const company = req.user.company;
  if (!company || !company.id) {
    res.status(403).json({ error: "No company on your account. Please sign in again." });
    return;
  }
  // Structural guard: ensure body is an object (coercion + unknown keys stripped).
  const parsed = createRetroSchema.safeParse(req.body || {});
  if (parsed.success) req.body = parsed.data;
  const { title } = req.body || {};
  const validatedTitle = validateText(title, "Title", maxRetroTitleLength, {
    required: true
  });
  if (validatedTitle.error) {
    res.status(400).json({ error: validatedTitle.error });
    return;
  }
  const retro = createRetro({ title: validatedTitle.value, companyId: company.id });
  state.retros.push(retro);
  if (!persistRetro(retro)) {
    res.status(500).json({ error: "Unable to persist retro." });
    return;
  }
  broadcastRetrosToLobby(company.id);
  res.status(201).json({ retro });
});

app.get("/api/retros/:id", auth.requireAuth, requireEntitled, (req, res) => {
  const retro = getRetro(req.params.id);
  if (!ensureBoardAccess(req, res, retro)) {
    return;
  }
  res.json({ retro });
});

app.post("/api/retros/:id/close", auth.requireAuth, requireEntitled, (req, res) => {
  const retro = getRetro(req.params.id);
  if (!ensureBoardAccess(req, res, retro)) {
    return;
  }
  retro.closed = true;
  retro.closedAt = new Date().toISOString();
  retro.timer.running = false;
  retro.timer.endAt = null;
  if (!persistRetro(retro)) {
    res.status(500).json({ error: "Unable to persist retro." });
    return;
  }
  broadcastToRetro(retro.id, { type: "retroClosed", retro });
  broadcastRetrosToLobby(retro.companyId);
  res.json({ retro });
});

app.get("/api/actions-report", auth.requireAuth, requireEntitled, (req, res) => {
  const company = req.user.company;
  const actions = [];
  state.retros.forEach((retro) => {
    if (!boardCompanyAllowed(retro, company)) {
      return;
    }
    (retro.actions || []).forEach((action) => {
      actions.push({
        retroId: retro.id,
        actionId: action.id,
        sourceCardId: action.sourceCardId || null,
        text: action.text,
        details: action.details || "",
        owner: action.owner || "",
        dueDate: action.dueDate || "",
        notes: action.notes || "",
        status: action.status || "todo",
        companyId: retro.companyId,
        company: company ? company.name : retro.companyId,
        retroTitle: retro.title,
        createdAt: retro.createdAt,
        closed: retro.closed
      });
    });
  });
  res.json({ actions });
});

app.put("/api/actions", auth.requireAuth, requireEntitled, (req, res) => {
  // Structural guard: coerce + strip unknown keys.
  const parsed = updateActionSchema.safeParse(req.body || {});
  if (parsed.success) req.body = parsed.data;
  const { retroId, actionId, status, notes, owner, dueDate } = req.body || {};
  const validatedRetroId = validateId(retroId, "retroId");
  const validatedActionId = validateId(actionId, "actionId");
  if (validatedRetroId.error || validatedActionId.error) {
    res.status(400).json({
      error: validatedRetroId.error || validatedActionId.error
    });
    return;
  }
  let nextStatus;
  if (status !== undefined) {
    const validatedStatus = validateActionStatus(status);
    if (validatedStatus.error) {
      res.status(400).json({ error: validatedStatus.error });
      return;
    }
    nextStatus = validatedStatus.value;
  }
  let nextNotes;
  if (notes !== undefined) {
    const validatedNotes = validateText(notes, "Action notes", maxActionNotesLength);
    if (validatedNotes.error) {
      res.status(400).json({ error: validatedNotes.error });
      return;
    }
    nextNotes = validatedNotes.value;
  }
  let nextOwner;
  if (owner !== undefined) {
    const validatedOwner = validateText(owner, "Action owner", maxActionOwnerLength);
    if (validatedOwner.error) {
      res.status(400).json({ error: validatedOwner.error });
      return;
    }
    nextOwner = validatedOwner.value;
  }
  let nextDueDate;
  if (dueDate !== undefined) {
    const validatedDueDate = validateDueDate(dueDate);
    if (validatedDueDate.error) {
      res.status(400).json({ error: validatedDueDate.error });
      return;
    }
    nextDueDate = validatedDueDate.value;
  }
  const retro = getRetro(validatedRetroId.value);
  if (!retro || !boardCompanyAllowed(retro, req.user.company)) {
    res.status(404).json({ error: "Retro not found." });
    return;
  }
  const action = (retro.actions || []).find(
    (item) => item.id === validatedActionId.value
  );
  if (!action) {
    res.status(404).json({ error: "Action not found." });
    return;
  }
  if (nextStatus !== undefined) {
    action.status = nextStatus;
  }
  if (nextNotes !== undefined) {
    action.notes = nextNotes;
  }
  if (nextOwner !== undefined) {
    action.owner = nextOwner;
  }
  if (nextDueDate !== undefined) {
    action.dueDate = nextDueDate;
  }
  if (!persistRetroAction(retro, action)) {
    res.status(500).json({ error: "Unable to persist action." });
    return;
  }
  res.json({ action });
});

app.use(makeErrorHandler({ logger, nodeEnv: process.env.NODE_ENV }));

const ALLOWED_ROLES = new Set(["participant", "facilitator"]);

function readConnParams(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawName = (url.searchParams.get("name") || "").trim().slice(0, 80);
  const rawRole = (url.searchParams.get("role") || "").trim().toLowerCase();
  return {
    retroId: url.searchParams.get("retroId"),
    view: url.searchParams.get("view"),
    name: rawName || "Anonymous",
    role: ALLOWED_ROLES.has(rawRole) ? rawRole : "participant"
  };
}

wss.on("connection", (ws, req) => {
  if (!isWebSocketOriginAllowed(req.headers)) {
    ws.send(JSON.stringify({ type: "error", message: "Origin not allowed." }));
    ws.close();
    return;
  }
  const { retroId, view, name, role } = readConnParams(req);
  const company = ws.company || null;
  const anonymous = !!ws.anonymous;

  if (view === "lobby") {
    if (anonymous || !company || !company.id) {
      ws.send(JSON.stringify({ type: "error", message: "Sign in to use the lobby." }));
      ws.close();
      return;
    }
    const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    clients.set(ws, { id: clientId, name, company: company.id, role, view: "lobby", anonymous: false });
    joinLobbyRoom(company.id, ws);
    ws.send(JSON.stringify({ type: "retros", retros: listRetrosForCompany(company.id) }));
    ws.on("close", () => {
      clients.delete(ws);
      leaveLobbyRoom(company.id, ws);
    });
    return;
  }

  const retro = retroId ? getRetro(retroId) : null;
  if (!retro) {
    ws.send(JSON.stringify({ type: "error", message: "Retro not found." }));
    ws.close();
    return;
  }
  if (anonymous) {
    if (retro.id !== ws.anonRetroId || retro.closed) {
      ws.send(JSON.stringify({ type: "error", message: "This retro is not available." }));
      ws.close();
      return;
    }
  } else if (!boardCompanyAllowed(retro, company)) {
    ws.send(JSON.stringify({ type: "error", message: "Retro not found." }));
    ws.close();
    return;
  }

  const effectiveRole = anonymous ? "participant" : role;
  const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  clients.set(ws, { id: clientId, name, retroId, role: effectiveRole, anonymous });
  joinRoom(retroId, ws);
  ws.send(JSON.stringify({ type: "init", retro }));

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      logger.warn({ err }, "ws message parse error — dropping");
      return;
    }
    if (!isPlainObject(data)) {
      return;
    }

    const msgType = typeof data.type === "string" ? data.type : "";
    const validation = validateMessage(msgType, data);
    if (!validation.ok) {
      logger.warn({ err: validation.error, type: msgType }, "invalid ws payload — dropping");
      return;
    }
    data = validation.data;

    const actor = clients.get(ws);

    if (data.type === "hello") {
      broadcastToRetro(retroId, {
        type: "presence",
        users: listPresence(retroId)
      });
    }

    if (data.type === "timer" && data.action) {
      if (retro.closed) {
        return;
      }
      if (!actor || actor.anonymous) {
        return;
      }
      const entry = clients.get(ws);
      if (!entry || entry.role !== "facilitator") {
        return;
      }
      if (!["set", "start", "stop", "reset"].includes(data.action)) {
        return;
      }
      if (data.action === "set") {
        const validatedMinutes = validateTimerMinutes(data.minutes);
        if (validatedMinutes.error) {
          return;
        }
        const minutes = validatedMinutes.value;
        retro.timer.durationSeconds = minutes * 60;
        retro.timer.remainingSeconds = retro.timer.durationSeconds;
        retro.timer.running = false;
        retro.timer.endAt = null;
      }

      if (data.action === "start") {
        if (data.minutes !== undefined) {
          const validatedMinutes = validateTimerMinutes(data.minutes);
          if (validatedMinutes.error) {
            return;
          }
          retro.timer.durationSeconds = validatedMinutes.value * 60;
          retro.timer.remainingSeconds = retro.timer.durationSeconds;
          retro.timer.running = false;
          retro.timer.endAt = null;
        }
        if (retro.timer.remainingSeconds <= 0) {
          retro.timer.remainingSeconds = retro.timer.durationSeconds;
        }
        retro.timer.running = true;
        retro.timer.endAt = Date.now() + retro.timer.remainingSeconds * 1000;
      }

      if (data.action === "stop") {
        if (retro.timer.running && retro.timer.endAt) {
          retro.timer.remainingSeconds = Math.max(
            0,
            Math.ceil((retro.timer.endAt - Date.now()) / 1000)
          );
        }
        retro.timer.running = false;
        retro.timer.endAt = null;
      }

      if (data.action === "reset") {
        retro.timer.remainingSeconds = retro.timer.durationSeconds;
        retro.timer.running = false;
        retro.timer.endAt = null;
      }

      if (!persistRetroTimer(retro)) {
        return;
      }
      broadcastToRetro(retroId, { type: "timer", timer: retro.timer });
      return;
    }

    if (data.type === "addCard") {
      if (retro.closed) {
        return;
      }
      const result = addCardToRetro(retro, data, actor);
      if (result.error) {
        return;
      }
      persistCardAndBroadcastRetro(retro, result.value);
      return;
    }

    if (data.type === "voteCard") {
      if (retro.closed) {
        return;
      }
      const result = voteCardInRetro(retro, data, actor);
      if (result.error) {
        return;
      }
      persistCardAndBroadcastRetro(retro, result.value);
      return;
    }

    if (data.type === "moveCard") {
      if (retro.closed) {
        return;
      }
      if (!actor || actor.anonymous) {
        return;
      }
      const result = moveCardInRetro(retro, data, actor);
      if (result.error) {
        return;
      }
      persistCardAndBroadcastRetro(retro, result.value);
      return;
    }

    if (data.type === "createAction") {
      if (retro.closed) {
        return;
      }
      if (!actor || actor.anonymous) {
        return;
      }
      const result = createActionFromCard(retro, data, actor);
      if (result.error) {
        return;
      }
      persistActionAndBroadcastRetro(retro, result.value);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    leaveRoom(retroId, ws);
    broadcastToRetro(retroId, {
      type: "presence",
      users: listPresence(retroId)
    });
  });
});

function startServer() {
  setInterval(() => {
    state.retros.forEach((retro) => {
      if (!retro.timer.running || !retro.timer.endAt) {
        return;
      }
      const remaining = Math.ceil((retro.timer.endAt - Date.now()) / 1000);
      let didFinish = false;
      if (remaining <= 0) {
        retro.timer.remainingSeconds = 0;
        retro.timer.running = false;
        retro.timer.endAt = null;
        didFinish = true;
      } else {
        retro.timer.remainingSeconds = remaining;
      }
      broadcastToRetro(retro.id, { type: "timer", timer: retro.timer });
      if (didFinish) {
        persistRetroTimer(retro);
      }
    });
  }, 1000);

  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    setInterval(runRetentionIfConfigured, 24 * 60 * 60 * 1000);
  }

  const port = Number.parseInt(process.env.PORT || "3001", 10);
  server.listen(port, () => {
    logger.info({ port }, "retro listening");
  });
}

initializeState(() => {
  reconcileTimers();
  runRetentionIfConfigured();
  startServer();
});
