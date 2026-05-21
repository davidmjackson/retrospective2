const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const Database = require("better-sqlite3");
const WebSocket = require("ws");

const rootDir = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start in time.\n${output}`));
    }, 5000);

    function handleData(chunk) {
      output += chunk.toString();
      if (output.includes("Retrospective board running")) {
        clearTimeout(timeout);
        resolve();
      }
    }

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}.\n${output}`));
    });
  });
}

async function request(baseUrl, route, options = {}, cookie = "") {
  const headers = { ...(options.headers || {}) };
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }
  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const body = text && contentType.includes("application/json") ? JSON.parse(text) : {};
  const setCookie = response.headers.get("set-cookie");

  return {
    status: response.status,
    body,
    text,
    headers: response.headers,
    cookie: setCookie ? setCookie.split(";")[0] : cookie
  };
}

function openSocket(baseWsUrl, retroId, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseWsUrl}?retroId=${encodeURIComponent(retroId)}`, {
      headers: { Cookie: cookie }
    });
    attachMessageBuffer(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function openLobbySocket(baseWsUrl, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseWsUrl}?view=lobby`, {
      headers: { Cookie: cookie }
    });
    attachMessageBuffer(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function openRejectedSocket(baseWsUrl, retroId, cookie, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseWsUrl}?retroId=${encodeURIComponent(retroId)}`, {
      headers: {
        Cookie: cookie,
        Origin: origin
      }
    });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out waiting for rejected WebSocket."));
    }, 3000);
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "error" && message.message === "Origin not allowed.") {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    ws.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function nextMessage(ws, predicate, label = "WebSocket message", timeoutMs = 3000) {
  attachMessageBuffer(ws);
  return new Promise((resolve, reject) => {
    const bufferedIndex = ws.__messageBuffer.findIndex((message) => {
      return !predicate || predicate(message);
    });
    if (bufferedIndex !== -1) {
      const [message] = ws.__messageBuffer.splice(bufferedIndex, 1);
      resolve(message);
      return;
    }

    const timeout = setTimeout(() => {
      const waiterIndex = ws.__messageWaiters.indexOf(waiter);
      if (waiterIndex !== -1) {
        ws.__messageWaiters.splice(waiterIndex, 1);
      }
      reject(
        new Error(
          `Timed out waiting for ${label}. Seen: ${JSON.stringify(
            ws.__messageBuffer.slice(-5)
          )}`
        )
      );
    }, timeoutMs);

    const waiter = { predicate, resolve, timeout };
    ws.__messageWaiters.push(waiter);
  });
}

function attachMessageBuffer(ws) {
  if (ws.__messageBuffer) {
    return;
  }
  ws.__messageBuffer = [];
  ws.__messageWaiters = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const waiterIndex = ws.__messageWaiters.findIndex((waiter) => {
      return !waiter.predicate || waiter.predicate(message);
    });
    if (waiterIndex !== -1) {
      const [waiter] = ws.__messageWaiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
      return;
    }
    ws.__messageBuffer.push(message);
  });
}

function closeSocket(ws) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

function assertLocalVendorAssets() {
  const pages = ["retrospective.html", "actions.html"];
  pages.forEach((page) => {
    const html = fs.readFileSync(path.join(rootDir, "public", page), "utf8");
    assert(!html.includes("unpkg.com"), `${page} still references unpkg.`);
    assert(
      html.includes("vendor/dragula/dragula.min.css"),
      `${page} does not load local Dragula CSS.`
    );
    assert(
      html.includes("vendor/dragula/dragula.min.js"),
      `${page} does not load local Dragula JS.`
    );
  });
  assert(
    fs.existsSync(path.join(rootDir, "public/vendor/dragula/dragula.min.css")),
    "Local Dragula CSS is missing."
  );
  assert(
    fs.existsSync(path.join(rootDir, "public/vendor/dragula/dragula.min.js")),
    "Local Dragula JS is missing."
  );
}

async function main() {
  assertLocalVendorAssets();

  const port = await getAvailablePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-test-"));
  const dbFile = path.join(tempDir, "retros.db");
  const baseUrl = `http://127.0.0.1:${port}`;
  const baseWsUrl = `ws://127.0.0.1:${port}`;
  let child;
  let socket;
  let facilitatorSocket;
  let lobbySocket;

  try {
    child = spawn(process.execPath, ["server.js"], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        RETRO_DB_PATH: dbFile,
        RETRO_AUTH_SECRET: "test-auth-secret",
        RETRO_ADMIN_KEY: "abc12",
        RETRO_LOGIN_RATE_LIMIT_MAX: "3",
        RETRO_LOGIN_RATE_LIMIT_WINDOW_MS: "60000"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    await waitForServer(child);

    const rootPage = await request(baseUrl, "/");
    assert(rootPage.status === 200, "Login page did not load.");
    assert(
      rootPage.headers.get("x-content-type-options") === "nosniff",
      "Missing X-Content-Type-Options header."
    );
    assert(
      rootPage.headers.get("x-frame-options") === "DENY",
      "Missing X-Frame-Options header."
    );
    assert(
      rootPage.headers.get("content-security-policy")?.includes("default-src 'self'"),
      "Missing Content-Security-Policy header."
    );
    assert(!rootPage.headers.has("x-powered-by"), "X-Powered-By header is exposed.");

    const health = await request(baseUrl, "/health");
    assert(health.status === 200, "Health check did not return OK.");
    assert(health.body.status === "ok", "Health check status is wrong.");
    assert(
      Number.isInteger(health.body.uptimeSeconds),
      "Health check uptime was not returned."
    );

    const licensePage = await request(baseUrl, "/license");
    assert(licensePage.status === 200, "Licence page did not load.");
    assert(
      licensePage.text.includes("David Jackson"),
      "Licence page does not name the developer."
    );

    const publicTeamCreate = await request(
      baseUrl,
      "/api/login",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Public Facilitator",
          role: "facilitator",
          team: "Public Created Team",
          createTeam: true
        })
      }
    );
    assert(
      publicTeamCreate.status === 403,
      "Public facilitator login was allowed to create a team."
    );

    const adminLogin = await request(
      baseUrl,
      "/api/login",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Admin User",
          role: "admin",
          team: "Admin",
          key: "abc12"
        })
      }
    );
    assert(adminLogin.status === 200, "Admin login failed.");
    assert(adminLogin.cookie, "Admin cookie was not set.");

    const operationsTeam = await request(
      baseUrl,
      "/api/teams",
      {
        method: "POST",
        body: JSON.stringify({ team: "Operations Team" })
      },
      adminLogin.cookie
    );
    assert(operationsTeam.status === 201, "Admin could not create team.");
    assert(operationsTeam.body.teamKey, "Created team key was not returned.");

    const facilitatorLogin = await request(
      baseUrl,
      "/api/login",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Facilitator",
          role: "facilitator",
          team: "Operations Team",
          key: operationsTeam.body.teamKey
        })
      }
    );
    assert(facilitatorLogin.status === 200, "Facilitator login failed.");
    assert(facilitatorLogin.cookie, "Facilitator cookie was not set.");

    const participantTeamCreate = await request(
      baseUrl,
      "/api/teams",
      {
        method: "POST",
        body: JSON.stringify({ team: "Participant Created Team" })
      },
      ""
    );
    assert(
      participantTeamCreate.status === 401,
      "Unauthenticated team creation did not fail."
    );

    const retroCreate = await request(
      baseUrl,
      "/api/retros",
      {
        method: "POST",
        body: JSON.stringify({ title: "Operation Regression" })
      },
      facilitatorLogin.cookie
    );
    assert(retroCreate.status === 201, "Retro creation failed.");
    const retroId = retroCreate.body.retro.id;

    const participantLogin = await request(
      baseUrl,
      "/api/login",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Participant",
          role: "participant",
          team: "Operations Team",
          key: operationsTeam.body.teamKey
        })
      }
    );
    assert(participantLogin.status === 200, "Participant login failed.");
    assert(participantLogin.cookie, "Participant cookie was not set.");

    const participantCreateTeam = await request(
      baseUrl,
      "/api/teams",
      {
        method: "POST",
        body: JSON.stringify({ team: "Participant Created Team" })
      },
      participantLogin.cookie
    );
    assert(
      participantCreateTeam.status === 403,
      "Participant was allowed to create a team."
    );

    const participantRetros = await request(
      baseUrl,
      "/api/retros",
      {},
      participantLogin.cookie
    );
    assert(participantRetros.status === 200, "Participant could not list retros.");
    assert(
      participantRetros.body.retros.some((retro) => retro.id === retroId),
      "Participant could not see team retro."
    );

    lobbySocket = await openLobbySocket(baseWsUrl, participantLogin.cookie);
    const initialLobbyRetros = await nextMessage(
      lobbySocket,
      (message) =>
        message.type === "retros" &&
        message.retros.some((retro) => retro.id === retroId && retro.closed === false),
      "initial lobby retro list"
    );
    assert(
      initialLobbyRetros.retros.some((retro) => retro.id === retroId),
      "Lobby WebSocket did not include the team retro."
    );

    const otherTeamCreate = await request(
      baseUrl,
      "/api/teams",
      {
        method: "POST",
        body: JSON.stringify({ team: "Other Team" })
      },
      facilitatorLogin.cookie
    );
    assert(otherTeamCreate.status === 201, "Facilitator could not create another team.");

    const otherTeamLogin = await request(
      baseUrl,
      "/api/login",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Other Facilitator",
          role: "facilitator",
          team: "Other Team",
          key: otherTeamCreate.body.teamKey
        })
      }
    );
    assert(otherTeamLogin.status === 200, "Other team login failed.");
    const crossTeamRetro = await request(
      baseUrl,
      `/api/retros/${encodeURIComponent(retroId)}`,
      {},
      otherTeamLogin.cookie
    );
    assert(crossTeamRetro.status === 404, "Cross-team retro access was not blocked.");

    const adminTeams = await request(
      baseUrl,
      "/api/admin/teams",
      {},
      adminLogin.cookie
    );
    assert(adminTeams.status === 200, "Admin could not list teams.");
    const otherTeamRecord = adminTeams.body.teams.find(
      (team) => team.name === "Other Team"
    );
    assert(otherTeamRecord, "Admin team list did not include Other Team.");
    assert(
      !("join_key" in otherTeamRecord) && !("key_hash" in otherTeamRecord),
      "Admin team list exposed team key material."
    );

    const rotate = await request(
      baseUrl,
      `/api/admin/teams/${otherTeamRecord.id}/rotate`,
      { method: "POST" },
      adminLogin.cookie
    );
    assert(rotate.status === 200, "Key rotation request failed.");
    assert(
      typeof rotate.body.teamKey === "string" &&
        /^[a-z0-9]{12}$/.test(rotate.body.teamKey),
      "Rotation did not return a fresh 12-character key."
    );
    assert(
      rotate.body.teamKey !== otherTeamCreate.body.teamKey,
      "Rotation returned the previous key."
    );

    const staleKeyLogin = await request(baseUrl, "/api/login", {
      method: "POST",
      body: JSON.stringify({
        name: "Stale Key User",
        role: "facilitator",
        team: "Other Team",
        key: otherTeamCreate.body.teamKey
      })
    });
    assert(
      staleKeyLogin.status === 403,
      "The previous key still worked after rotation."
    );

    const rotatedKeyLogin = await request(baseUrl, "/api/login", {
      method: "POST",
      body: JSON.stringify({
        name: "Rotated Key User",
        role: "facilitator",
        team: "Other Team",
        key: rotate.body.teamKey
      })
    });
    assert(rotatedKeyLogin.status === 200, "The rotated key did not work.");

    const adminTeamRecord = adminTeams.body.teams.find(
      (team) => team.name === "Admin"
    );
    assert(adminTeamRecord, "Admin team was not listed.");
    const adminRotate = await request(
      baseUrl,
      `/api/admin/teams/${adminTeamRecord.id}/rotate`,
      { method: "POST" },
      adminLogin.cookie
    );
    assert(
      adminRotate.status === 403,
      "The Admin team key should not be rotatable through the API."
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failedLogin = await request(baseUrl, "/api/login", {
        method: "POST",
        headers: { "X-Forwarded-For": "203.0.113.10" },
        body: JSON.stringify({
          name: "Blocked User",
          role: "participant",
          team: "Operations Team",
          key: "wrong"
        })
      });
      assert(failedLogin.status === 403, "Expected failed login before rate limit.");
    }
    const limitedLogin = await request(baseUrl, "/api/login", {
      method: "POST",
      headers: { "X-Forwarded-For": "203.0.113.10" },
      body: JSON.stringify({
        name: "Blocked User",
        role: "participant",
        team: "Operations Team",
        key: "wrong"
      })
    });
    assert(limitedLogin.status === 429, "Login rate limit did not activate.");
    assert(limitedLogin.headers.get("retry-after"), "Rate limit did not set Retry-After.");

    socket = await openSocket(baseWsUrl, retroId, participantLogin.cookie);
    await nextMessage(socket, (message) => message.type === "init", "initial retro state");

    await openRejectedSocket(
      baseWsUrl,
      retroId,
      participantLogin.cookie,
      "https://attacker.example"
    );

    socket.send(
      JSON.stringify({
        type: "addCard",
        column: "well",
        text: "Server-owned card",
        details: "created through an operation"
      })
    );
    const afterAdd = await nextMessage(
      socket,
      (message) => message.type === "update" && message.retro.columns.well.length === 1,
      "card add update"
    );
    const cardId = afterAdd.retro.columns.well[0].id;
    assert(cardId, "Server did not assign a card id.");
    assert(
      afterAdd.retro.columns.well[0].createdBy === "Participant",
      "Card creator was not assigned."
    );

    socket.send(JSON.stringify({ type: "voteCard", cardId }));
    socket.send(JSON.stringify({ type: "voteCard", cardId }));
    await nextMessage(
      socket,
      (message) => message.type === "update" && message.retro.columns.well[0]?.votes === 1,
      "first vote update"
    );
    const afterVotes = await nextMessage(
      socket,
      (message) => message.type === "update" && message.retro.columns.well[0]?.votes === 2,
      "second vote update"
    );
    assert(afterVotes.retro.columns.well[0].votes === 2, "Votes did not accumulate.");

    socket.send(
      JSON.stringify({
        type: "moveCard",
        cardId,
        targetColumn: "continue",
        beforeCardId: null
      })
    );
    const afterMove = await nextMessage(
      socket,
      (message) => message.type === "update" && message.retro.columns.continue.length === 1,
      "move to continue update"
    );
    const continueCard = afterMove.retro.columns.continue[0];
    assert(continueCard.id === cardId, "Moved continue card id changed.");
    assert(!continueCard.status, "Continue card should not have action status.");
    assert(continueCard.votes === 2, "Moved continue card lost votes.");

    socket.send(
      JSON.stringify({
        type: "createAction",
        cardId,
        title: "Confirm server action",
        owner: "Release Owner",
        dueDate: "2026-05-20",
        notes: "Created from integration test"
      })
    );
    const afterActionCreate = await nextMessage(
      socket,
      (message) => message.type === "update" && message.retro.actions?.length === 1,
      "create action update"
    );
    const actionId = afterActionCreate.retro.actions[0].id;
    assert(actionId, "Action item id was not assigned.");
    assert(
      afterActionCreate.retro.actions[0].sourceCardId === cardId,
      "Action item is not linked to the source card."
    );
    assert(
      afterActionCreate.retro.actions[0].text === "Confirm server action",
      "Action title was not applied."
    );
    assert(
      afterActionCreate.retro.actions[0].owner === "Release Owner",
      "Action owner was not applied."
    );
    assert(
      afterActionCreate.retro.actions[0].dueDate === "2026-05-20",
      "Action due date was not applied."
    );

    facilitatorSocket = await openSocket(baseWsUrl, retroId, facilitatorLogin.cookie);
    await nextMessage(
      facilitatorSocket,
      (message) => message.type === "init",
      "facilitator initial retro state"
    );
    facilitatorSocket.send(JSON.stringify({ type: "timer", action: "set", minutes: 2 }));
    await nextMessage(
      facilitatorSocket,
      (message) =>
        message.type === "timer" &&
        message.timer.durationSeconds === 120 &&
        message.timer.remainingSeconds === 120,
      "timer set update"
    );
    facilitatorSocket.send(JSON.stringify({ type: "timer", action: "start", minutes: 1 }));
    const timerStart = await nextMessage(
      facilitatorSocket,
      (message) =>
        message.type === "timer" &&
        message.timer.durationSeconds === 60 &&
        message.timer.remainingSeconds === 60 &&
        message.timer.running === true &&
        Number.isFinite(message.timer.endAt),
      "timer start update"
    );
    await nextMessage(
      facilitatorSocket,
      (message) =>
        message.type === "timer" &&
        message.timer.durationSeconds === 60 &&
        message.timer.remainingSeconds < timerStart.timer.remainingSeconds,
      "timer countdown update",
      2500
    );
    const runningTimerDb = new Database(dbFile, { readonly: true });
    try {
      const runningTimer = runningTimerDb
        .prepare(
          "SELECT timer_duration_seconds, timer_running, timer_end_at FROM retros WHERE id = ?"
        )
        .get(retroId);
      assert(runningTimer, "Running timer state was not persisted to SQLite.");
      assert(runningTimer.timer_duration_seconds === 60, "Timer start duration was not persisted.");
      assert(runningTimer.timer_running === 1, "Timer running flag was not persisted.");
      assert(runningTimer.timer_end_at, "Timer end time was not persisted.");
    } finally {
      runningTimerDb.close();
    }
    facilitatorSocket.send(JSON.stringify({ type: "timer", action: "reset" }));
    await nextMessage(
      facilitatorSocket,
      (message) =>
        message.type === "timer" &&
        message.timer.durationSeconds === 60 &&
        message.timer.remainingSeconds === 60 &&
        message.timer.running === false &&
        message.timer.endAt === null,
      "timer reset update"
    );

    const invalidStatus = await request(
      baseUrl,
      "/api/actions",
      {
        method: "PUT",
        body: JSON.stringify({
          retroId,
          actionId,
          status: "invalid"
        })
      },
      participantLogin.cookie
    );
    assert(invalidStatus.status === 400, "Invalid action status was accepted.");

    const updateAction = await request(
      baseUrl,
      "/api/actions",
      {
        method: "PUT",
        body: JSON.stringify({
          retroId,
          actionId,
          owner: "Delivery Lead",
          dueDate: "2026-05-28",
          notes: "Updated from actions report"
        })
      },
      participantLogin.cookie
    );
    assert(updateAction.status === 200, "Action details could not be updated.");

    const closeEvent = nextMessage(
      socket,
      (message) => message.type === "retroClosed" && message.retro.closed === true,
      "retro closed event"
    );
    const lobbyCloseEvent = nextMessage(
      lobbySocket,
      (message) =>
        message.type === "retros" &&
        message.retros.some((retro) => retro.id === retroId && retro.closed === true),
      "lobby retro closed update"
    );
    const closeRetro = await request(
      baseUrl,
      `/api/retros/${encodeURIComponent(retroId)}/close`,
      { method: "POST" },
      facilitatorLogin.cookie
    );
    assert(closeRetro.status === 200, "Facilitator could not close retro.");
    await Promise.all([closeEvent, lobbyCloseEvent]);

    socket.send(
      JSON.stringify({
        type: "addCard",
        column: "continue",
        text: "Should not persist after close",
        details: ""
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const closedRetro = await request(
      baseUrl,
      `/api/retros/${encodeURIComponent(retroId)}`,
      {},
      participantLogin.cookie
    );
    assert(closedRetro.status === 200, "Participant could not reload closed retro.");
    assert(closedRetro.body.retro.closed === true, "Retro was not marked closed.");
    assert(
      closedRetro.body.retro.columns.continue.length === 1,
      "Closed retro accepted a WebSocket mutation."
    );

    const persistedDb = new Database(dbFile, { readonly: true });
    try {
      const persistedCard = persistedDb
        .prepare(
          "SELECT column_type, votes, status, notes, created_by FROM cards WHERE id = ? AND retro_id = ?"
        )
        .get(cardId, retroId);
      assert(persistedCard, "Card operation was not persisted to SQLite.");
      assert(persistedCard.column_type === "continue", "Persisted card column is wrong.");
      assert(persistedCard.votes === 2, "Persisted card vote count is wrong.");
      assert(persistedCard.status === null, "Persisted continue card has action status.");
      assert(
        persistedCard.created_by === "Participant",
        "Persisted card creator is wrong."
      );

      const persistedAction = persistedDb
        .prepare(
          "SELECT source_card_id, text, status, owner, due_date, notes FROM actions WHERE id = ? AND retro_id = ?"
        )
        .get(actionId, retroId);
      assert(persistedAction, "Action item was not persisted to SQLite.");
      assert(
        persistedAction.source_card_id === cardId,
        "Persisted action source card is wrong."
      );
      assert(persistedAction.status === "todo", "Persisted action status is wrong.");
      assert(persistedAction.text === "Confirm server action", "Persisted action title is wrong.");
      assert(persistedAction.owner === "Delivery Lead", "Persisted action owner is wrong.");
      assert(persistedAction.due_date === "2026-05-28", "Persisted action due date is wrong.");
      assert(
        persistedAction.notes === "Updated from actions report",
        "Persisted action notes are wrong."
      );

      const persistedRetro = persistedDb
        .prepare(
          "SELECT closed, timer_duration_seconds, timer_remaining_seconds FROM retros WHERE id = ?"
        )
        .get(retroId);
      assert(persistedRetro, "Retro was not persisted to SQLite.");
      assert(persistedRetro.closed === 1, "Closed retro state was not persisted.");
      assert(
        persistedRetro.timer_duration_seconds === 60,
        "Timer duration was not persisted with targeted timer update."
      );
      assert(
        persistedRetro.timer_remaining_seconds === 60,
        "Timer remaining time was not persisted with targeted timer update."
      );
    } finally {
      persistedDb.close();
    }

    console.log("WebSocket/API integration test passed.");
  } finally {
    closeSocket(socket);
    closeSocket(facilitatorSocket);
    closeSocket(lobbySocket);
    if (child && child.exitCode === null && !child.killed) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
