const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();

app.use(express.static(path.join(__dirname, "public")));

const stateFile = path.join(__dirname, "state.json");

const defaultState = {
  columns: {
    well: [
      { id: "w1", text: "Clear sprint goal" },
      { id: "w2", text: "Fast code reviews" }
    ],
    improve: [{ id: "i1", text: "Reduce meeting overlap" }],
    action: [{ id: "a1", text: "Timebox refinement" }]
  },
  timer: {
    durationSeconds: 300,
    remainingSeconds: 300,
    running: false,
    endAt: null
  }
};

let state = {
  ...defaultState,
  lastAction: null
};

if (fs.existsSync(stateFile)) {
  try {
    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.columns) {
      state = {
        ...parsed,
        lastAction: parsed.lastAction || null,
        timer: {
          ...defaultState.timer,
          ...parsed.timer
        }
      };
    }
  } catch (err) {
    console.warn("Failed to load state.json, using defaults.");
  }
}

if (state.timer.running && state.timer.endAt) {
  const remaining = Math.ceil((state.timer.endAt - Date.now()) / 1000);
  if (remaining <= 0) {
    state.timer.remainingSeconds = 0;
    state.timer.running = false;
    state.timer.endAt = null;
  } else {
    state.timer.remainingSeconds = remaining;
  }
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

wss.on("connection", (ws) => {
  const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  clients.set(ws, { id: clientId, name: "Anonymous" });
  ws.send(JSON.stringify({ type: "init", state }));

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
      broadcast({
        type: "presence",
        users: Array.from(clients.values()).map((client) => client.name)
      });
    }

    if (data.type === "timer" && data.action) {
      if (data.action === "set" && Number.isFinite(data.minutes)) {
        const minutes = Math.max(1, Math.floor(data.minutes));
        state.timer.durationSeconds = minutes * 60;
        state.timer.remainingSeconds = state.timer.durationSeconds;
        state.timer.running = false;
        state.timer.endAt = null;
      }

      if (data.action === "start") {
        if (state.timer.remainingSeconds <= 0) {
          state.timer.remainingSeconds = state.timer.durationSeconds;
        }
        state.timer.running = true;
        state.timer.endAt = Date.now() + state.timer.remainingSeconds * 1000;
      }

      if (data.action === "stop") {
        if (state.timer.running && state.timer.endAt) {
          state.timer.remainingSeconds = Math.max(
            0,
            Math.ceil((state.timer.endAt - Date.now()) / 1000)
          );
        }
        state.timer.running = false;
        state.timer.endAt = null;
      }

      if (data.action === "reset") {
        state.timer.remainingSeconds = state.timer.durationSeconds;
        state.timer.running = false;
        state.timer.endAt = null;
      }

      try {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      } catch (err) {
        console.warn("Failed to write state.json.");
      }

      broadcast({ type: "timer", timer: state.timer });
      return;
    }

    if (data.type === "setState" && data.state && data.state.columns) {
      state.columns = data.state.columns;
      state.lastAction = data.state.lastAction || null;
      try {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      } catch (err) {
        console.warn("Failed to write state.json.");
      }
      broadcast({ type: "update", state });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcast({
      type: "presence",
      users: Array.from(clients.values()).map((client) => client.name)
    });
  });
});

setInterval(() => {
  if (!state.timer.running || !state.timer.endAt) {
    return;
  }
  const remaining = Math.ceil((state.timer.endAt - Date.now()) / 1000);
  if (remaining <= 0) {
    state.timer.remainingSeconds = 0;
    state.timer.running = false;
    state.timer.endAt = null;
  } else {
    state.timer.remainingSeconds = remaining;
  }
  broadcast({ type: "timer", timer: state.timer });
}, 1000);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Retrospective board running on http://localhost:${port}`);
});
