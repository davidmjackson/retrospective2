const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const rooms = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const stateFile = path.join(__dirname, "state.json");

const defaultTimer = {
  durationSeconds: 300,
  remainingSeconds: 300,
  running: false,
  endAt: null
};

const defaultColumns = {
  well: [],
  improve: [],
  action: []
};

function normalizeActionCard(card) {
  return {
    ...card,
    status: card.status || "todo",
    notes: card.notes || ""
  };
}

function normalizeColumns(columns) {
  const cloneList = (list) =>
    Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  return {
    well: cloneList(columns.well),
    improve: cloneList(columns.improve),
    action: Array.isArray(columns.action)
      ? columns.action.map((item) => normalizeActionCard({ ...item }))
      : []
  };
}

function normalizeTimer(timer) {
  return {
    ...defaultTimer,
    ...(timer || {})
  };
}

function normalizeRetro(retro) {
  return {
    id: retro.id,
    title: retro.title || "Retrospective",
    team: retro.team || "General",
    createdAt: retro.createdAt || new Date().toISOString(),
    closed: Boolean(retro.closed),
    closedAt: retro.closedAt || null,
    columns: normalizeColumns(retro.columns || defaultColumns),
    timer: normalizeTimer(retro.timer),
    lastAction: retro.lastAction || null
  };
}

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
      action: []
    },
    timer: { ...defaultTimer },
    lastAction: null
  });
}

let state = { retros: [] };

function loadState() {
  if (!fs.existsSync(stateFile)) {
    return;
  }
  try {
    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.retros)) {
      state.retros = parsed.retros.map(normalizeRetro);
      return;
    }
    if (parsed && parsed.columns) {
      const migrated = normalizeRetro({
        id: "retro-1",
        title: "Retrospective",
        team: "General",
        createdAt: new Date().toISOString(),
        closed: false,
        closedAt: null,
        columns: parsed.columns,
        timer: parsed.timer,
        lastAction: parsed.lastAction || null
      });
      state.retros = [migrated];
    }
  } catch (err) {
    console.warn("Failed to load state.json, using defaults.");
  }
}

function saveState() {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn("Failed to write state.json.");
  }
}

loadState();

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

app.get("/retro", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/actions", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "actions.html"));
});

app.get("/api/retros", (req, res) => {
  const retros = state.retros.map((retro) => ({
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
  const { title, team } = req.body || {};
  if (!title || !team) {
    res.status(400).json({ error: "Title and team are required." });
    return;
  }
  const retro = createRetro({ title, team });
  state.retros.push(retro);
  saveState();
  res.status(201).json({ retro });
});

app.get("/api/retros/:id", (req, res) => {
  const retro = getRetro(req.params.id);
  if (!retro) {
    res.status(404).json({ error: "Retro not found." });
    return;
  }
  res.json({ retro });
});

app.post("/api/retros/:id/close", (req, res) => {
  const retro = getRetro(req.params.id);
  if (!retro) {
    res.status(404).json({ error: "Retro not found." });
    return;
  }
  retro.closed = true;
  retro.closedAt = new Date().toISOString();
  retro.timer.running = false;
  retro.timer.endAt = null;
  saveState();
  broadcastToRetro(retro.id, { type: "retroClosed", retro });
  res.json({ retro });
});

app.get("/api/actions-report", (req, res) => {
  const actions = [];
  state.retros.forEach((retro) => {
    retro.columns.action.forEach((action) => {
      actions.push({
        retroId: retro.id,
        actionId: action.id,
        text: action.text,
        details: action.details || "",
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
  const { retroId, actionId, status, notes } = req.body || {};
  if (!retroId || !actionId) {
    res.status(400).json({ error: "retroId and actionId are required." });
    return;
  }
  const retro = getRetro(retroId);
  if (!retro) {
    res.status(404).json({ error: "Retro not found." });
    return;
  }
  const action = retro.columns.action.find((item) => item.id === actionId);
  if (!action) {
    res.status(404).json({ error: "Action not found." });
    return;
  }
  if (typeof status === "string") {
    action.status = status;
  }
  if (typeof notes === "string") {
    action.notes = notes;
  }
  saveState();
  res.json({ action });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const retroId = url.searchParams.get("retroId");
  const retro = retroId ? getRetro(retroId) : null;
  if (!retro) {
    ws.send(JSON.stringify({ type: "error", message: "Retro not found." }));
    ws.close();
    return;
  }

  const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  clients.set(ws, { id: clientId, name: "Anonymous", retroId });
  joinRoom(retroId, ws);
  ws.send(JSON.stringify({ type: "init", retro }));

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    if (data.type === "hello" && typeof data.user === "string") {
      const entry = clients.get(ws);
      if (entry) {
        entry.name = data.user.trim() || "Anonymous";
      }
      broadcastToRetro(retroId, {
        type: "presence",
        users: listPresence(retroId)
      });
    }

    if (data.type === "timer" && data.action) {
      if (retro.closed) {
        return;
      }
      if (data.action === "set" && Number.isFinite(data.minutes)) {
        const minutes = Math.max(1, Math.floor(data.minutes));
        retro.timer.durationSeconds = minutes * 60;
        retro.timer.remainingSeconds = retro.timer.durationSeconds;
        retro.timer.running = false;
        retro.timer.endAt = null;
      }

      if (data.action === "start") {
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

      saveState();
      broadcastToRetro(retroId, { type: "timer", timer: retro.timer });
      return;
    }

    if (data.type === "setState" && data.state && data.state.columns) {
      if (retro.closed) {
        return;
      }
      retro.columns = normalizeColumns(data.state.columns);
      retro.lastAction = data.state.lastAction || null;
      saveState();
      broadcastToRetro(retroId, { type: "update", retro });
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

setInterval(() => {
  let didUpdate = false;
  state.retros.forEach((retro) => {
    if (!retro.timer.running || !retro.timer.endAt) {
      return;
    }
    const remaining = Math.ceil((retro.timer.endAt - Date.now()) / 1000);
    if (remaining <= 0) {
      retro.timer.remainingSeconds = 0;
      retro.timer.running = false;
      retro.timer.endAt = null;
    } else {
      retro.timer.remainingSeconds = remaining;
    }
    didUpdate = true;
    broadcastToRetro(retro.id, { type: "timer", timer: retro.timer });
  });
  if (didUpdate) {
    saveState();
  }
}, 1000);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Retrospective board running on http://localhost:${port}`);
});
