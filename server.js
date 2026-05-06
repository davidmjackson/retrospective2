const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
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
  getTeamByName,
  createTeam,
  ensureAdminTeam,
  listTeams,
  deleteTeamById,
  getTeamById
} = require("./db");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const rooms = new Map();

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

function createRetro({ title, team }) {
  return normalizeRetro({
    id: `retro-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    team,
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
    try {
      ensureAdminTeam(db, adminKey);
    } catch (adminErr) {
      console.warn("Failed to ensure Admin team.");
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

if (!/^[a-z0-9]{5}$/.test(adminKey)) {
  console.error("RETRO_ADMIN_KEY must be 5 lowercase letters or digits.");
  process.exit(1);
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
    votes: 0
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

  const action = {
    id: createActionId(),
    sourceCardId: location.card.id,
    text: location.card.text,
    details: location.card.details || "",
    owner: auth.name || "Anonymous",
    dueDate: "",
    status: "todo",
    notes: "",
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

function ensureTeamAccess(req, res, retro) {
  const auth = requireAuth(req, res);
  if (!auth) {
    return null;
  }
  if (!retro || (retro.team || "").toLowerCase() !== auth.normalizedTeam) {
    res.status(404).json({ error: "Retro not found." });
    return null;
  }
  return auth;
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

function closeTeamRooms(teamName) {
  const normalized = (teamName || "").toLowerCase();
  if (!normalized) {
    return;
  }
  const retroIds = state.retros
    .filter((retro) => (retro.team || "").toLowerCase() === normalized)
    .map((retro) => retro.id);
  retroIds.forEach((retroId) => {
    const room = rooms.get(retroId);
    if (!room) {
      return;
    }
    for (const client of room) {
      try {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: "error", message: "Team deleted." }));
        }
        client.close();
      } catch (err) {
        // ignore
      }
      clients.delete(client);
    }
    rooms.delete(retroId);
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/lobby", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "lobby.html"));
});

app.get("/retrospective", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "retrospective.html"));
});

app.get("/retro", (req, res) => {
  res.redirect(302, "/retrospective");
});

app.get("/actions", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "actions.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.post("/api/login", (req, res) => {
  const { name, role, team, key, createTeam: createTeamRequest } = req.body || {};
  const safeRole = typeof role === "string" ? role.trim().toLowerCase() : "participant";
  const safeKey = typeof key === "string" ? key.trim().toLowerCase() : "";
  const wantsCreate = Boolean(createTeamRequest);
  const rateLimitKey = getLoginRateLimitKey(req, safeRole, team);
  const rateLimit = checkLoginRateLimit(rateLimitKey);
  if (rateLimit.limited) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }
  const validatedName = validateText(name, "Name", maxNameLength, {
    required: true
  });
  const validatedTeam = validateText(team, "Team", maxTeamLength, {
    required: true
  });

  if (validatedName.error) {
    rejectLogin(res, rateLimitKey, 400, validatedName.error);
    return;
  }
  if (validatedTeam.error) {
    rejectLogin(res, rateLimitKey, 400, validatedTeam.error);
    return;
  }
  const safeName = validatedName.value;
  const safeTeam = validatedTeam.value;
  if (!["participant", "facilitator", "admin"].includes(safeRole)) {
    rejectLogin(res, rateLimitKey, 400, "Invalid role.");
    return;
  }
  if (safeRole !== "admin" && safeTeam.toLowerCase() === "admin") {
    rejectLogin(res, rateLimitKey, 403, "Admin team is restricted.");
    return;
  }
  if (safeKey && !/^[a-z0-9]{5}$/.test(safeKey)) {
    rejectLogin(
      res,
      rateLimitKey,
      400,
      "Team key must be 5 lowercase letters or digits."
    );
    return;
  }

  let teamRecord = getTeamByName(db, safeTeam);
  let createdKey = null;
  let createdTeam = false;

  if (safeRole === "admin") {
    if (safeTeam.toLowerCase() !== "admin") {
      rejectLogin(res, rateLimitKey, 400, "Admin role must use the Admin team.");
      return;
    }
    if (!teamRecord) {
      rejectLogin(res, rateLimitKey, 404, "Admin team not found.");
      return;
    }
    if (!safeKey || safeKey !== teamRecord.join_key) {
      rejectLogin(res, rateLimitKey, 403, "Invalid admin key.");
      return;
    }
  } else if (safeRole === "participant") {
    if (!teamRecord) {
      rejectLogin(res, rateLimitKey, 404, "Team not found.");
      return;
    }
    if (!safeKey || safeKey !== teamRecord.join_key) {
      rejectLogin(res, rateLimitKey, 403, "Invalid team key.");
      return;
    }
  } else {
    if (wantsCreate) {
      if (safeTeam.toLowerCase() === "admin") {
        rejectLogin(res, rateLimitKey, 403, "Admin team is restricted.");
        return;
      }
      if (teamRecord) {
        rejectLogin(res, rateLimitKey, 409, "Team already exists.");
        return;
      }
      try {
        const created = createTeam(db, safeTeam);
        teamRecord = { name: created.name, join_key: created.joinKey };
        createdKey = created.joinKey;
        createdTeam = true;
      } catch (err) {
        if (err && err.code === "TEAM_EXISTS") {
          rejectLogin(res, rateLimitKey, 409, "Team already exists.");
          return;
        }
        rejectLogin(res, rateLimitKey, 500, "Unable to create team.");
        return;
      }
    } else {
      if (!teamRecord) {
        rejectLogin(res, rateLimitKey, 404, "Team not found.");
        return;
      }
      if (!safeKey || safeKey !== teamRecord.join_key) {
        rejectLogin(res, rateLimitKey, 403, "Invalid team key.");
        return;
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number.isFinite(authTtlHours) && authTtlHours > 0
    ? authTtlHours * 3600
    : 24 * 3600;
  const teamName =
    safeRole === "admin" ? "Admin" : teamRecord ? teamRecord.name : safeTeam;
  const payload = {
    name: safeName,
    role: safeRole,
    team: teamName,
    iat: now,
    exp: now + ttlSeconds
  };
  const token = signToken(payload);
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie("retro_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(isSecure),
    maxAge: ttlSeconds * 1000,
    path: "/"
  });
  clearLoginAttempts(rateLimitKey);
  res.json({
    user: { name: safeName, role: safeRole, team: teamName },
    teamKey: createdKey,
    createdTeam
  });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("retro_auth", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }
  res.json({
    user: {
      name: auth.name,
      role: auth.role,
      team: auth.team
    }
  });
});

app.get("/api/admin/teams", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }
  if (auth.role !== "admin") {
    res.status(403).json({ error: "Admin role required." });
    return;
  }
  const teams = listTeams(db);
  res.json({ teams });
});

app.delete("/api/admin/teams/:id", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }
  if (auth.role !== "admin") {
    res.status(403).json({ error: "Admin role required." });
    return;
  }
  const team = getTeamById(db, req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found." });
    return;
  }
  if (team.name.toLowerCase() === "admin") {
    res.status(403).json({ error: "Admin team cannot be deleted." });
    return;
  }
  closeTeamRooms(team.name);
  deleteTeamById(db, team.id);
  state.retros = state.retros.filter(
    (retro) => (retro.team || "").toLowerCase() !== team.name.toLowerCase()
  );
  res.json({ ok: true });
});

app.get("/api/retros", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }
  const retros = state.retros
    .filter((retro) => {
      return (retro.team || "").toLowerCase() === auth.normalizedTeam;
    })
    .map((retro) => ({
      id: retro.id,
      title: retro.title,
      team: retro.team,
      createdAt: retro.createdAt,
      closed: retro.closed,
      closedAt: retro.closedAt
    }));
  res.json({ retros });
});

app.post("/api/retros", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }
  if (auth.role !== "facilitator") {
    res.status(403).json({ error: "Facilitator role required." });
    return;
  }
  const { title } = req.body || {};
  const validatedTitle = validateText(title, "Title", maxRetroTitleLength, {
    required: true
  });
  if (validatedTitle.error) {
    res.status(400).json({ error: validatedTitle.error });
    return;
  }
  const retro = createRetro({ title: validatedTitle.value, team: auth.team });
  state.retros.push(retro);
  if (!persistRetro(retro)) {
    res.status(500).json({ error: "Unable to persist retro." });
    return;
  }
  res.status(201).json({ retro });
});

app.get("/api/retros/:id", (req, res) => {
  const retro = getRetro(req.params.id);
  if (!ensureTeamAccess(req, res, retro)) {
    return;
  }
  res.json({ retro });
});

app.post("/api/retros/:id/close", (req, res) => {
  const retro = getRetro(req.params.id);
  const auth = ensureTeamAccess(req, res, retro);
  if (!auth) {
    return;
  }
  if (auth.role !== "facilitator") {
    res.status(403).json({ error: "Facilitator role required." });
    return;
  }
  retro.closed = true;
  retro.closedAt = new Date().toISOString();
  retro.timer.running = false;
  retro.timer.endAt = null;
  if (!persistRetro(retro)) {
    res.status(500).json({ error: "Unable to close retro." });
    return;
  }
  broadcastToRetro(retro.id, { type: "retroClosed", retro });
  res.json({ retro });
});

app.get("/api/actions-report", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }
  const actions = [];
  state.retros.forEach((retro) => {
    if ((retro.team || "").toLowerCase() !== auth.normalizedTeam) {
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
        team: retro.team,
        retroTitle: retro.title,
        createdAt: retro.createdAt,
        closed: retro.closed
      });
    });
  });
  res.json({ actions });
});

app.put("/api/actions", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) {
    return;
  }
  const { retroId, actionId, status, notes } = req.body || {};
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
  const retro = getRetro(validatedRetroId.value);
  if (!retro || (retro.team || "").toLowerCase() !== auth.normalizedTeam) {
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
  if (!persistRetroAction(retro, action)) {
    res.status(500).json({ error: "Unable to persist action." });
    return;
  }
  res.json({ action });
});

wss.on("connection", (ws, req) => {
  if (!isWebSocketOriginAllowed(req.headers)) {
    ws.send(JSON.stringify({ type: "error", message: "Origin not allowed." }));
    ws.close();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const retroId = url.searchParams.get("retroId");
  const auth = getAuthFromHeaders(req.headers);
  const retro = retroId ? getRetro(retroId) : null;
  if (!auth) {
    ws.send(JSON.stringify({ type: "error", message: "Unauthorized." }));
    ws.close();
    return;
  }
  if (
    !retro ||
    !auth.team ||
    (retro.team || "").toLowerCase() !== auth.normalizedTeam
  ) {
    ws.send(JSON.stringify({ type: "error", message: "Retro not found." }));
    ws.close();
    return;
  }

  const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  clients.set(ws, {
    id: clientId,
    name: auth.name || "Anonymous",
    retroId,
    role: auth.role
  });
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
      const result = addCardToRetro(retro, data, auth);
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
      const result = voteCardInRetro(retro, data, auth);
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
      const result = moveCardInRetro(retro, data, auth);
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
      const result = createActionFromCard(retro, data, auth);
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
