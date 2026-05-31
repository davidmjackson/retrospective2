const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
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
  applyRetention,
  createRetroRow,
  getRetroById,
  getRetrosForTeamId
} = require("./db");
const { createAuthClient } = require("@suite/auth-client");
const { authenticateUpgrade } = require("./lib/upgradeAuth");
const { teamIdInTeams, boardTeamAllowed } = require("./lib/teamAccess");

const app = express();
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
  const url = String(req.url || "");
  if (url !== "/ws" && !url.startsWith("/ws?")) {
    socket.destroy();
    return;
  }
  let result;
  try {
    result = await authenticateUpgrade(auth.verifySession, req.headers.cookie);
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
    ws.hubUserId = result.context.userId;
    ws.teams = result.context.teams;
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

function createRetro({ title, teamId }) {
  return normalizeRetro({
    id: `retro-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    teamId,
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
      console.warn("Failed to initialize database.");
      callback();
      return;
    }
    loadRetros(db, (loadErr, retros) => {
      if (loadErr) {
        console.warn("Failed to load retros from database.");
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
          console.warn("Failed to seed from state.json.");
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
      console.warn("Failed to persist retros.");
    }
  });
}

function persistRetro(retro) {
  let didSave = true;
  saveRetro(db, retro, (err) => {
    if (err) {
      didSave = false;
      console.warn("Failed to persist retro.");
    }
  });
  return didSave;
}

function persistRetroTimer(retro) {
  let didSave = true;
  saveRetroTimer(db, retro, (err) => {
    if (err) {
      didSave = false;
      console.warn("Failed to persist retro timer.");
    }
  });
  return didSave;
}

function persistRetroCard(retro, columnType, card) {
  let didSave = true;
  saveRetroCard(db, retro, columnType, card, (err) => {
    if (err) {
      didSave = false;
      console.warn("Failed to persist retro card.");
    }
  });
  return didSave;
}

function persistRetroAction(retro, action) {
  let didSave = true;
  saveRetroAction(db, retro, action, (err) => {
    if (err) {
      didSave = false;
      console.warn("Failed to persist retro action.");
    }
  });
  return didSave;
}

const isProduction = process.env.NODE_ENV === "production";
const configuredAuthSecret = process.env.RETRO_AUTH_SECRET || "";
const authSecret = configuredAuthSecret || crypto.randomBytes(32).toString("hex");
const authTtlHours = Number.parseInt(
  process.env.RETRO_AUTH_TTL_HOURS || "24",
  10
);
const adminKey = (process.env.RETRO_ADMIN_KEY || "admin").trim().toLowerCase();
const allowedActionStatuses = new Set(["todo", "in_progress", "blocked", "done"]);
const maxNameLength = 80;
const maxTeamLength = 80;
const maxRetroTitleLength = 140;
const maxCardTextLength = 500;
const maxCardDetailsLength = 2000;
const maxActionNotesLength = 4000;
const maxActionOwnerLength = 80;
const maxActionDueDateLength = 10;
const maxTimerMinutes = 240;
const maxCardsPerColumn = 100;
const loginRateLimitWindowMs = Number.parseInt(
  process.env.RETRO_LOGIN_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`,
  10
);
const loginRateLimitMax = Number.parseInt(
  process.env.RETRO_LOGIN_RATE_LIMIT_MAX || "20",
  10
);
const allowedOrigins = (process.env.RETRO_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const loginAttempts = new Map();

if (isProduction && !configuredAuthSecret) {
  console.error("RETRO_AUTH_SECRET must be set in production.");
  process.exit(1);
}

if (isProduction && (!process.env.RETRO_ADMIN_KEY || adminKey === "admin")) {
  console.error("RETRO_ADMIN_KEY must be set to a non-default value in production.");
  process.exit(1);
}

if (!/^[a-z0-9]{5,64}$/.test(adminKey)) {
  console.error("RETRO_ADMIN_KEY must be 5-64 lowercase letters or digits.");
  process.exit(1);
}

if (adminKey.length < 12) {
  console.warn(
    "RETRO_ADMIN_KEY is shorter than 12 characters; a longer key is recommended."
  );
}

if (!process.env.RETRO_AUTH_SECRET) {
  console.warn("RETRO_AUTH_SECRET not set. Sessions will reset on restart.");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function getLoginRateLimitKey(req, role, team) {
  const safeRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  const safeTeam = typeof team === "string" ? team.trim().toLowerCase() : "";
  return `${getClientIp(req)}:${safeRole}:${safeTeam}`;
}

function pruneLoginAttempts(now) {
  if (!Number.isFinite(loginRateLimitWindowMs) || loginRateLimitWindowMs <= 0) {
    return;
  }
  for (const [key, entry] of loginAttempts.entries()) {
    if (now - entry.resetAt >= loginRateLimitWindowMs) {
      loginAttempts.delete(key);
    }
  }
}

function checkLoginRateLimit(key) {
  if (
    !Number.isFinite(loginRateLimitWindowMs) ||
    loginRateLimitWindowMs <= 0 ||
    !Number.isFinite(loginRateLimitMax) ||
    loginRateLimitMax <= 0
  ) {
    return { limited: false };
  }
  const now = Date.now();
  pruneLoginAttempts(now);
  const entry = loginAttempts.get(key);
  if (!entry || now >= entry.resetAt) {
    return { limited: false };
  }
  if (entry.count >= loginRateLimitMax) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }
  return { limited: false };
}

function recordFailedLoginAttempt(key) {
  if (
    !Number.isFinite(loginRateLimitWindowMs) ||
    loginRateLimitWindowMs <= 0 ||
    !Number.isFinite(loginRateLimitMax) ||
    loginRateLimitMax <= 0
  ) {
    return;
  }
  const now = Date.now();
  pruneLoginAttempts(now);
  const entry = loginAttempts.get(key);
  if (!entry || now >= entry.resetAt) {
    loginAttempts.set(key, {
      count: 1,
      resetAt: now + loginRateLimitWindowMs
    });
    return;
  }
  entry.count += 1;
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

function rejectLogin(res, key, status, error) {
  recordFailedLoginAttempt(key);
  res.status(status).json({ error });
}

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

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4 || 4)) % 4;
  const normalized = `${padded}${"=".repeat(padLength)}`;
  return Buffer.from(normalized, "base64").toString("utf8");
}

function signToken(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", authSecret)
    .update(body)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${body}.${signature}`;
}

function verifyToken(token) {
  const [body, signature] = (token || "").split(".");
  if (!body || !signature) {
    return null;
  }
  const expected = crypto
    .createHmac("sha256", authSecret)
    .update(body)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  if (expected.length !== signature.length) {
    return null;
  }
  const matches = crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
  if (!matches) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return acc;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      return acc;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function getAuthFromRequest(req) {
  const authHeader = req.get("authorization") || "";
  let token = "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies.retro_auth || "";
  }
  if (!token) {
    return null;
  }
  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }
  return {
    name: payload.name,
    role: payload.role,
    team: payload.team,
    normalizedTeam: (payload.team || "").toLowerCase(),
    exp: payload.exp,
    iat: payload.iat
  };
}

function getAuthFromHeaders(headers) {
  const authHeader =
    typeof headers.authorization === "string" ? headers.authorization : "";
  let token = "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookies = parseCookies({ headers });
    token = cookies.retro_auth || "";
  }
  if (!token) {
    return null;
  }
  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }
  return {
    name: payload.name,
    role: payload.role,
    team: payload.team,
    normalizedTeam: (payload.team || "").toLowerCase(),
    exp: payload.exp,
    iat: payload.iat
  };
}

function requireAuth(req, res) {
  const auth = getAuthFromRequest(req);
  if (!auth || !auth.team) {
    res.status(401).json({ error: "Unauthorized." });
    return null;
  }
  return auth;
}

function ensureBoardAccess(req, res, retro) {
  if (!retro || !boardTeamAllowed(retro, req.user.teams)) {
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
      console.warn("Failed to apply retention policy.");
      return;
    }
    state.retros = state.retros.filter((retro) => !removedIds.includes(retro.id));
  });
}

function getRetro(id) {
  return state.retros.find((retro) => retro.id === id);
}

function listRetrosForTeam(teamId) {
  return state.retros
    .filter((retro) => retro.teamId === teamId)
    .map((retro) => ({
      id: retro.id,
      title: retro.title,
      teamId: retro.teamId,
      createdAt: retro.createdAt,
      closed: retro.closed,
      closedAt: retro.closedAt
    }));
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

function broadcastRetrosToLobby(teamName) {
  broadcastToLobby(teamName, {
    type: "retros",
    retros: listRetrosForTeam(teamName)
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

app.get("/api/me", auth.requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id }, teams: req.user.teams || [] });
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
  const teamId = String(req.query.teamId || "");
  if (!teamIdInTeams(teamId, req.user.teams)) {
    res.status(403).json({ error: "Not a member of that team." });
    return;
  }
  res.json({ retros: listRetrosForTeam(teamId) });
});

app.post("/api/retros", auth.requireAuth, requireEntitled, (req, res) => {
  const { title, teamId } = req.body || {};
  if (!teamIdInTeams(teamId, req.user.teams)) {
    res.status(403).json({ error: "Not a member of that team." });
    return;
  }
  const validatedTitle = validateText(title, "Title", maxRetroTitleLength, {
    required: true
  });
  if (validatedTitle.error) {
    res.status(400).json({ error: validatedTitle.error });
    return;
  }
  const retro = createRetro({ title: validatedTitle.value, teamId });
  state.retros.push(retro);
  if (!persistRetro(retro)) {
    res.status(500).json({ error: "Unable to persist retro." });
    return;
  }
  broadcastRetrosToLobby(teamId);
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
  broadcastRetrosToLobby(retro.teamId);
  res.json({ retro });
});

app.get("/api/actions-report", auth.requireAuth, requireEntitled, (req, res) => {
  const actions = [];
  state.retros.forEach((retro) => {
    if (!boardTeamAllowed(retro, req.user.teams)) {
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
        teamId: retro.teamId,
        retroTitle: retro.title,
        createdAt: retro.createdAt,
        closed: retro.closed
      });
    });
  });
  res.json({ actions });
});

app.put("/api/actions", auth.requireAuth, requireEntitled, (req, res) => {
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
  if (!retro || !boardTeamAllowed(retro, req.user.teams)) {
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

const ALLOWED_ROLES = new Set(["participant", "facilitator"]);

function readConnParams(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawName = (url.searchParams.get("name") || "").trim().slice(0, 80);
  const rawRole = (url.searchParams.get("role") || "").trim().toLowerCase();
  return {
    retroId: url.searchParams.get("retroId"),
    view: url.searchParams.get("view"),
    teamId: url.searchParams.get("teamId"),
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
  const { retroId, view, teamId, name, role } = readConnParams(req);
  const teams = Array.isArray(ws.teams) ? ws.teams : [];

  if (view === "lobby") {
    if (!teamIdInTeams(teamId, teams)) {
      ws.send(JSON.stringify({ type: "error", message: "Not a member of that team." }));
      ws.close();
      return;
    }
    const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    clients.set(ws, { id: clientId, name, team: teamId, role, view: "lobby" });
    joinLobbyRoom(teamId, ws);
    ws.send(JSON.stringify({ type: "retros", retros: listRetrosForTeam(teamId) }));
    ws.on("close", () => {
      clients.delete(ws);
      leaveLobbyRoom(teamId, ws);
    });
    return;
  }

  const retro = retroId ? getRetro(retroId) : null;
  if (!boardTeamAllowed(retro, teams)) {
    ws.send(JSON.stringify({ type: "error", message: "Retro not found." }));
    ws.close();
    return;
  }

  const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  clients.set(ws, { id: clientId, name, retroId, role });
  joinRoom(retroId, ws);
  ws.send(JSON.stringify({ type: "init", retro }));

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }
    if (!isPlainObject(data)) {
      return;
    }

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
    console.log(`Retrospective board running on http://localhost:${port}`);
  });
}

initializeState(() => {
  reconcileTimers();
  runRetentionIfConfigured();
  startServer();
});
