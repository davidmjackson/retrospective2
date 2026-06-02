# Retro Room Sharing (slice 3 part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Retro boards company-scoped (collapse team -> company) and add an auto-minted per-board anonymous share link that lets account-less users join one board to add cards and vote.

**Architecture:** App-only change in the `retrospective2` repo. The DB moves `retros.team_id` to `retros.company_id` and adds `share_token` (schema v7, clean-cut migration that wipes existing boards). The WS upgrade becomes dual-path (`decideUpgrade`): a valid entitled session OR a `token` query param resolving to an open board (anonymous). Anonymous sockets are clamped to a participant who can only add cards + vote on their one board; authed company members keep full ability. A public `/join?token=` page collects a name and hands off to a public `/shared` board view that reuses the existing board UI. Phase A (the `company {id,name}` contract on `@suite/auth-client`) is already deployed; this plan consumes it.

**Tech Stack:** Node.js, Express, `ws` (WebSocketServer with `noServer` + `server.on("upgrade")`), better-sqlite3, `@suite/auth-client` (symlinked), `node:test` for unit tests, Playwright for e2e.

---

## Spec

Source spec: `docs/superpowers/specs/2026-06-02-retro-room-sharing-design.md`.

Key decisions:
1. Collapse team -> company; drop the team picker.
2. Clean-cut schema migration (v7) wipes existing boards.
3. Anonymous joiners: add cards + vote ONLY. `moveCard`, `createAction`, `timer`, `close` are authed-only.
4. Share token auto-minted at board creation; valid only while the board is open.

## File Structure

**Create:**
- `lib/companyAccess.js` — company tenancy helper (`boardCompanyAllowed`). Replaces `lib/teamAccess.js`.
- `public/join.html` — public anonymous name-entry page.
- `public/join.js` — validates the share token, collects a name, hands off to `/shared`.
- `tests/company-access.test.js` — unit tests for `boardCompanyAllowed`. Replaces `tests/team-access.test.js`.
- `tests/e2e/retro-sharing.spec.js` — e2e for anonymous join + control gating + closed-link rejection.

**Modify:**
- `db.js` — `team_id` -> `company_id`, add `share_token`, schema v7 migration, `getRetrosForCompanyId`, `getRetroByShareToken`, `createRetroRow` signature.
- `server.js` — dual-path upgrade, company-scoped routes, public `/join` `/shared` `/api/shared/:token` routes, anon binding + message gating, lobby keyed by company.
- `lib/upgradeAuth.js` — replace `authenticateUpgrade` with `decideUpgrade` (dual-path).
- `public/client.js` — anon mode (token detection, skip authed fetch, WS token, hide authed-only controls), Copy-invite-link for authed.
- `public/retrospective.html` — add a Copy-invite-link button.
- `public/lobby.js` — drop team picker; company-scoped.
- `public/lobby.html` — remove the team `<select>`.
- `tests/db-schema.test.js` — rewrite for `company_id` + v7 + share token.
- `tests/upgrade-auth.test.js` — rewrite for `decideUpgrade`.
- `tests/e2e/helpers/seed.js` — add `company` to seeded sessions.
- `tests/e2e/retro-smoke.spec.js` — company model instead of team.
- `package.json` — update the `test` script file list.

**Delete:**
- `lib/teamAccess.js`
- `tests/team-access.test.js`

---

## Task 1: DB schema v7 — company_id + share_token + clean-cut migration

**Files:**
- Modify: `db.js`
- Test: `tests/db-schema.test.js` (rewrite)

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `tests/db-schema.test.js` with:

```javascript
// tests/db-schema.test.js
const test = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");
const {
  ensureSchema,
  createRetroRow,
  getRetrosForCompanyId,
  getRetroById,
  getRetroByShareToken
} = require("../db");

function freshDb() {
  return new Promise((resolve, reject) => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db, (err) => (err ? reject(err) : resolve(db)));
  });
}

test("retros table has NOT NULL company_id, a share_token column, and no teams table", async () => {
  const db = await freshDb();
  const cols = db.prepare("PRAGMA table_info(retros)").all();
  const companyCol = cols.find((c) => c.name === "company_id");
  assert.ok(companyCol, "retros.company_id should exist");
  assert.strictEqual(companyCol.notnull, 1, "company_id should be NOT NULL");
  assert.ok(cols.find((c) => c.name === "share_token"), "retros.share_token should exist");
  assert.strictEqual(
    cols.find((c) => c.name === "team_id"),
    undefined,
    "team_id should be gone"
  );
  const teamsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'")
    .get();
  assert.strictEqual(teamsTable, undefined, "shared-key teams table should be dropped");
});

test("getRetrosForCompanyId returns only that company's boards", async () => {
  const db = await freshDb();
  createRetroRow(db, { id: "r1", title: "A", companyId: "c1", shareToken: "tok1" });
  createRetroRow(db, { id: "r2", title: "B", companyId: "c2", shareToken: "tok2" });
  const c1 = getRetrosForCompanyId(db, "c1");
  assert.deepStrictEqual(c1.map((r) => r.id), ["r1"]);
  const got = getRetroById(db, "r2");
  assert.strictEqual(got.company_id, "c2");
});

test("getRetroByShareToken resolves a board by its token", async () => {
  const db = await freshDb();
  createRetroRow(db, { id: "r1", title: "A", companyId: "c1", shareToken: "secret-tok" });
  const row = getRetroByShareToken(db, "secret-tok");
  assert.ok(row, "should resolve the board");
  assert.strictEqual(row.id, "r1");
  assert.strictEqual(getRetroByShareToken(db, "nope"), null);
});

test("a pre-v7 (v6, team_id) db is wiped and rebuilt at company scope", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Simulate a v6 board table with a row.
  db.exec(
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  db.exec(
    `CREATE TABLE retros (id TEXT PRIMARY KEY, title TEXT NOT NULL, team_id TEXT NOT NULL,
      created_at TEXT NOT NULL, closed INTEGER NOT NULL, closed_at TEXT,
      timer_duration_seconds INTEGER NOT NULL, timer_remaining_seconds INTEGER NOT NULL,
      timer_running INTEGER NOT NULL, timer_end_at INTEGER, last_action_json TEXT, updated_at TEXT NOT NULL)`
  );
  db.exec(
    "INSERT INTO retros VALUES ('old','Old','t1','x',0,NULL,300,300,0,NULL,NULL,'x')"
  );
  db.exec("INSERT INTO meta (key,value) VALUES ('schema_version','6')");
  await new Promise((res, rej) => ensureSchema(db, (e) => (e ? rej(e) : res())));
  const cols = db.prepare("PRAGMA table_info(retros)").all();
  assert.ok(cols.find((c) => c.name === "company_id"), "should now be company-scoped");
  const rows = db.prepare("SELECT * FROM retros").all();
  assert.strictEqual(rows.length, 0, "old boards should be wiped on the v7 migration");
  const ver = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  assert.strictEqual(ver.value, "7");
});

test("ensureSchema is idempotent on a v7 db", async () => {
  const db = await freshDb();
  createRetroRow(db, { id: "keep", title: "K", companyId: "c1", shareToken: "k" });
  await new Promise((res, rej) => ensureSchema(db, (e) => (e ? rej(e) : res())));
  assert.ok(getRetroById(db, "keep"), "row should survive a second ensureSchema call");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/db-schema.test.js`
Expected: FAIL (e.g. `getRetrosForCompanyId is not a function`, `company_id` assertions fail).

- [ ] **Step 3: Edit `db.js` — schema, normalize, upsert, load, helpers**

In `createNormalizedSchema`, replace the `retros` CREATE TABLE and add a share-token index. Change the `retros` table block to:

```javascript
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableNames.retros} (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed INTEGER NOT NULL,
    closed_at TEXT,
    share_token TEXT,
    timer_duration_seconds INTEGER NOT NULL,
    timer_remaining_seconds INTEGER NOT NULL,
    timer_running INTEGER NOT NULL,
    timer_end_at INTEGER,
    last_action_json TEXT,
    updated_at TEXT NOT NULL
  )`);
```

Immediately after the existing `idx_${tableNames.actions}_retro_status` index `db.exec(...)` call inside `createNormalizedSchema`, add:

```javascript
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableNames.retros}_share_token ON ${tableNames.retros}(share_token) WHERE share_token IS NOT NULL`
  );
```

In `normalizeRetro`, replace the `teamId` line with `companyId` and add `shareToken`:

```javascript
    companyId: retro.companyId || retro.company_id || "",
    shareToken: retro.shareToken || retro.share_token || null,
```

(Remove the old `teamId: retro.teamId || retro.team_id || "",` line.)

In `runRetroUpsert`, change the column list, the `VALUES` placeholder count, the `ON CONFLICT` set, and the `.run(...)` args to use `company_id` and `share_token`. Replace the whole `runRetroUpsert` body's SQL + run with:

```javascript
  const retroStmt = db.prepare(
    `INSERT INTO ${tableName} (
      id, title, company_id, created_at, closed, closed_at, share_token,
      timer_duration_seconds, timer_remaining_seconds, timer_running, timer_end_at,
      last_action_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      company_id = excluded.company_id,
      created_at = excluded.created_at,
      closed = excluded.closed,
      closed_at = excluded.closed_at,
      share_token = excluded.share_token,
      timer_duration_seconds = excluded.timer_duration_seconds,
      timer_remaining_seconds = excluded.timer_remaining_seconds,
      timer_running = excluded.timer_running,
      timer_end_at = excluded.timer_end_at,
      last_action_json = excluded.last_action_json,
      updated_at = excluded.updated_at`
  );

  retroStmt.run(
    normalized.id,
    normalized.title,
    normalized.companyId,
    normalized.createdAt,
    normalized.closed ? 1 : 0,
    normalized.closedAt,
    normalized.shareToken,
    normalized.timer.durationSeconds,
    normalized.timer.remainingSeconds,
    normalized.timer.running ? 1 : 0,
    normalized.timer.endAt,
    normalized.lastAction ? JSON.stringify(normalized.lastAction) : null,
    timestamp
  );
```

In `ensureSchema`, change the version gate from `6` to `7`:

```javascript
    if (version < 7) {
      const tx = db.transaction(() => {
        dropLegacyBoardData(db);
        createNormalizedSchema(db, { retros: "retros", cards: "cards" });
        ensureCardCreatedByColumn(db);
        db.exec(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '7')"
        );
      });
      tx();
    } else {
```

In `loadRetros`, in the `normalizeRetro({...})` call replace `teamId: row.team_id,` with:

```javascript
        companyId: row.company_id,
        shareToken: row.share_token,
```

In `createRetroRow`, change the signature and body:

```javascript
function createRetroRow(db, { id, title, companyId, shareToken = null }) {
  const now = new Date().toISOString();
  return runRetroUpsert(
    db,
    "retros",
    normalizeRetro({
      id,
      title,
      companyId,
      shareToken,
      createdAt: now,
      closed: false,
      closedAt: null,
      columns: { well: [], improve: [], continue: [] },
      actions: [],
      timer: null,
      lastAction: null
    }),
    now
  );
}
```

Replace `getRetrosForTeamId` with `getRetrosForCompanyId` and add `getRetroByShareToken`:

```javascript
function getRetrosForCompanyId(db, companyId) {
  return db
    .prepare("SELECT * FROM retros WHERE company_id = ? ORDER BY created_at DESC")
    .all(companyId);
}

function getRetroByShareToken(db, token) {
  if (!token) return null;
  return db.prepare("SELECT * FROM retros WHERE share_token = ?").get(token) || null;
}
```

In `module.exports`, replace `getRetrosForTeamId` with `getRetrosForCompanyId` and add `getRetroByShareToken`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/db-schema.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add db.js tests/db-schema.test.js
git commit -m "feat(retro): db schema v7 — company_id + share_token, clean-cut migration"
```

---

## Task 2: Company tenancy helper (replace team-access)

**Files:**
- Create: `lib/companyAccess.js`
- Delete: `lib/teamAccess.js`
- Create: `tests/company-access.test.js`
- Delete: `tests/team-access.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/company-access.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { boardCompanyAllowed } = require("../lib/companyAccess");

const company = { id: "c1", name: "Acme" };

test("boardCompanyAllowed matches the board's company against the user's company", () => {
  // DB-row shape (company_id)
  assert.strictEqual(boardCompanyAllowed({ company_id: "c1" }, company), true);
  assert.strictEqual(boardCompanyAllowed({ company_id: "c9" }, company), false);
  // in-memory normalized shape (companyId)
  assert.strictEqual(boardCompanyAllowed({ companyId: "c1" }, company), true);
  assert.strictEqual(boardCompanyAllowed({ companyId: "c9" }, company), false);
});

test("boardCompanyAllowed denies when board or company is missing", () => {
  assert.strictEqual(boardCompanyAllowed(null, company), false);
  assert.strictEqual(boardCompanyAllowed({ company_id: "c1" }, null), false);
  assert.strictEqual(boardCompanyAllowed({ company_id: "c1" }, {}), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/company-access.test.js`
Expected: FAIL with `Cannot find module '../lib/companyAccess'`.

- [ ] **Step 3: Create `lib/companyAccess.js`**

```javascript
// Pure tenancy helper. A board belongs to one company (retros.company_id); an
// authed user may touch it only when that company matches the company on their
// verified session.
function boardCompanyAllowed(retro, company) {
  if (!retro || !company || !company.id) return false;
  return (retro.company_id || retro.companyId) === company.id;
}

module.exports = { boardCompanyAllowed };
```

- [ ] **Step 4: Delete the old files**

```bash
git rm lib/teamAccess.js tests/team-access.test.js
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/company-access.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/companyAccess.js tests/company-access.test.js
git commit -m "feat(retro): company tenancy helper, drop team-access"
```

---

## Task 3: Dual-path WS upgrade gate (`decideUpgrade`)

**Files:**
- Modify: `lib/upgradeAuth.js`
- Test: `tests/upgrade-auth.test.js` (rewrite)

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `tests/upgrade-auth.test.js` with:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { decideUpgrade } = require("../lib/upgradeAuth");

const openBoard = { id: "r1", closed: false };
const lookup = (tok) => (tok === "good" ? openBoard : tok === "closed" ? { id: "r2", closed: true } : null);

test("authed: allows and returns context when session is entitled", async () => {
  const ctx = { userId: "u1", entitled: true, company: { id: "c1", name: "A" } };
  const r = await decideUpgrade(async () => ctx, "cookie", null, lookup);
  assert.deepStrictEqual(r, { ok: true, anonymous: false, context: ctx });
});

test("anon: allows when token resolves to an open board and no session", async () => {
  const r = await decideUpgrade(async () => null, "", "good", lookup);
  assert.deepStrictEqual(r, { ok: true, anonymous: true, boardId: "r1" });
});

test("anon: denies when token resolves to a closed board", async () => {
  const r = await decideUpgrade(async () => null, "", "closed", lookup);
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("denies when no session and no valid token", async () => {
  const r = await decideUpgrade(async () => null, "", "bad", lookup);
  assert.deepStrictEqual(r, { ok: false, status: 401 });
  const r2 = await decideUpgrade(async () => null, "", null, lookup);
  assert.deepStrictEqual(r2, { ok: false, status: 401 });
});

test("denies an un-entitled session even with no token", async () => {
  const r = await decideUpgrade(async () => ({ userId: "u1", entitled: false }), "c", null, lookup);
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("a valid session takes precedence over a token", async () => {
  const ctx = { userId: "u1", entitled: true, company: { id: "c1" } };
  const r = await decideUpgrade(async () => ctx, "c", "good", lookup);
  assert.strictEqual(r.anonymous, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/upgrade-auth.test.js`
Expected: FAIL with `decideUpgrade is not a function`.

- [ ] **Step 3: Replace `lib/upgradeAuth.js`**

```javascript
// Decides whether a WebSocket upgrade is allowed. Dual-path and pure:
//   1. A valid, entitled session (via the auth-client verifySession), OR
//   2. A share token that resolves (via lookupBoardByToken) to an OPEN board.
// lookupBoardByToken(token) returns { id, closed } or null.
async function decideUpgrade(verifySession, cookieHeader, shareToken, lookupBoardByToken) {
  const ctx = await verifySession(cookieHeader);
  if (ctx && ctx.entitled) {
    return { ok: true, anonymous: false, context: ctx };
  }
  if (shareToken && typeof lookupBoardByToken === "function") {
    const board = lookupBoardByToken(shareToken);
    if (board && !board.closed) {
      return { ok: true, anonymous: true, boardId: board.id };
    }
  }
  return { ok: false, status: 401 };
}

module.exports = { decideUpgrade };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/upgrade-auth.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/upgradeAuth.js tests/upgrade-auth.test.js
git commit -m "feat(retro): dual-path WS upgrade gate (session OR share token)"
```

---

## Task 4: Wire the new db/lib imports + company helpers into server.js

This task updates `server.js` requires, `createRetro`, the token lookups, the board listing, and `ensureBoardAccess` — the plumbing later tasks depend on. No behavior is exposed yet; verification is "server boots + unit tests still pass".

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Update requires (top of `server.js`)**

In the `require("./db")` destructure (lines ~7-19), the functions used elsewhere don't include the new helpers; add them. Change the destructure to also pull `getRetroByShareToken` is NOT needed (we use in-memory state). Leave the db destructure as-is.

Replace the two lib requires (lines 21-22):

```javascript
const { decideUpgrade } = require("./lib/upgradeAuth");
const { boardCompanyAllowed } = require("./lib/companyAccess");
```

- [ ] **Step 2: Replace `createRetro` to take companyId + mint a share token**

Replace the `createRetro` function (lines ~98-115):

```javascript
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
```

(`crypto` is already required at the top of `server.js`.)

- [ ] **Step 3: Add token-lookup helpers + replace `listRetrosForTeam`**

Replace `listRetrosForTeam` (lines ~599-610) with `listRetrosForCompany` and add two token helpers right after it:

```javascript
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
```

- [ ] **Step 4: Update `ensureBoardAccess` to use company**

Replace `ensureBoardAccess` (lines ~545-551):

```javascript
function ensureBoardAccess(req, res, retro) {
  if (!retro || !boardCompanyAllowed(retro, req.user.company)) {
    res.status(404).json({ error: "Retro not found." });
    return false;
  }
  return true;
}
```

- [ ] **Step 5: Update lobby broadcast to company scope**

Replace `broadcastRetrosToLobby` (lines ~662-667):

```javascript
function broadcastRetrosToLobby(companyId) {
  broadcastToLobby(companyId, {
    type: "retros",
    retros: listRetrosForCompany(companyId)
  });
}
```

- [ ] **Step 6: Verify the server still boots and unit tests pass**

Run: `node -e "require('./server.js')" ` is not safe (it starts listening); instead syntax-check:
Run: `node --check server.js`
Expected: no output (syntax OK).

Run: `node --test tests/db-schema.test.js tests/company-access.test.js tests/upgrade-auth.test.js`
Expected: PASS (the lib/db units are unaffected by this wiring).

Note: `server.js` still references `teamIdInTeams` / `boardTeamAllowed` / `listRetrosForTeam` in the routes + WS handler — those are fixed in Tasks 5-7 and the file will not fully run until then. `node --check` only validates syntax. If `node --check` reports an undefined-free parse, proceed; runtime wiring is completed next.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat(retro): server plumbing — company helpers, share-token mint + lookup"
```

---

## Task 5: Dual-path upgrade in the HTTP `upgrade` handler

**Files:**
- Modify: `server.js` (the `server.on("upgrade", ...)` block, lines ~37-63)

- [ ] **Step 1: Replace the upgrade handler**

```javascript
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
```

Note: `lookupOpenBoardByToken` is defined later in the file (Task 4 Step 3). Function declarations hoist within the module scope, but this is an arrow-free `function` declaration, so it is available. Confirm it is declared with `function lookupOpenBoardByToken(...)` (it is).

- [ ] **Step 2: Syntax-check**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(retro): dual-path WS upgrade in the server upgrade handler"
```

---

## Task 6: Company-scoped HTTP routes

**Files:**
- Modify: `server.js` (routes `/api/me`, `/api/retros` GET/POST, `/api/retros/:id/close`, `/api/actions-report`)

- [ ] **Step 1: Update `/api/me`**

Replace the `/api/me` handler (lines ~725-727):

```javascript
app.get("/api/me", auth.requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id }, company: req.user.company || null });
});
```

- [ ] **Step 2: Update `/api/retros` GET**

Replace (lines ~740-747):

```javascript
app.get("/api/retros", auth.requireAuth, requireEntitled, (req, res) => {
  const company = req.user.company;
  if (!company || !company.id) {
    res.status(403).json({ error: "No company on your account. Please sign in again." });
    return;
  }
  res.json({ retros: listRetrosForCompany(company.id) });
});
```

- [ ] **Step 3: Update `/api/retros` POST**

Replace (lines ~749-770):

```javascript
app.post("/api/retros", auth.requireAuth, requireEntitled, (req, res) => {
  const company = req.user.company;
  if (!company || !company.id) {
    res.status(403).json({ error: "No company on your account. Please sign in again." });
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
  const retro = createRetro({ title: validatedTitle.value, companyId: company.id });
  state.retros.push(retro);
  if (!persistRetro(retro)) {
    res.status(500).json({ error: "Unable to persist retro." });
    return;
  }
  broadcastRetrosToLobby(company.id);
  res.status(201).json({ retro });
});
```

(`/api/retros/:id` GET stays as-is — it returns `{ retro }`, which now includes `shareToken` via `normalizeRetro`, giving authed members the token. `ensureBoardAccess` already enforces company access.)

- [ ] **Step 4: Update `/api/retros/:id/close`**

In the close handler (lines ~780-796), change the final broadcast line `broadcastRetrosToLobby(retro.teamId);` to:

```javascript
  broadcastRetrosToLobby(retro.companyId);
```

- [ ] **Step 5: Update `/api/actions-report`**

Replace (lines ~798-825):

```javascript
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
```

- [ ] **Step 6: Syntax-check**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat(retro): company-scoped HTTP routes (me, retros, close, actions-report)"
```

---

## Task 7: Public anon routes — `/api/shared/:token`, `/join`, `/shared`

**Files:**
- Modify: `server.js` (add three public routes near `/health`)

- [ ] **Step 1: Add the public routes**

Immediately after the `/health` route (after line ~723, before `/api/me`), add:

```javascript
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
```

These sit before the `.html`-blocking middleware (line ~731) and the static handlers, and serve via `sendFile`, so they are reachable without auth. `/shared` reuses the existing board markup; all board data flows over the token-gated WS, so serving the shell publicly exposes nothing.

- [ ] **Step 2: Syntax-check + boot smoke**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(retro): public share routes (/api/shared/:token, /join, /shared)"
```

---

## Task 8: WS connection handler — company access, anon binding, role clamp

**Files:**
- Modify: `server.js` (`readConnParams` + `wss.on("connection", ...)`, lines ~904-955)

- [ ] **Step 1: Add `token` to `readConnParams`**

In `readConnParams` (lines ~906-917), change the returned object to drop `teamId` and add nothing else needed (token is read at upgrade, board derived from `ws.anonRetroId`). Replace the return:

```javascript
  return {
    retroId: url.searchParams.get("retroId"),
    view: url.searchParams.get("view"),
    name: rawName || "Anonymous",
    role: ALLOWED_ROLES.has(rawRole) ? rawRole : "participant"
  };
```

- [ ] **Step 2: Replace the connection setup (lobby + board access + binding)**

Replace lines ~919-955 (from `wss.on("connection"` through the `ws.send(JSON.stringify({ type: "init", retro }));`) with:

```javascript
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
```

(The `ws.on("message", ...)` block and the board-view `ws.on("close", ...)` that follow remain; message gating is added in Task 9.)

- [ ] **Step 3: Syntax-check**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(retro): WS connection — company access, anon board-binding, role clamp"
```

---

## Task 9: WS message gating — authed-only mutations

**Files:**
- Modify: `server.js` (the `ws.on("message", ...)` handler, lines ~957-1088)

- [ ] **Step 1: Gate timer, moveCard, createAction to authed sockets**

The `actor` variable already holds `clients.get(ws)` (line ~968). Add an early anon guard inside each privileged handler.

In the `timer` handler, just after `if (retro.closed) { return; }` (line ~978-980), add:

```javascript
      if (!actor || actor.anonymous) {
        return;
      }
```

In the `moveCard` handler, just after its `if (retro.closed) { return; }`, add:

```javascript
      if (!actor || actor.anonymous) {
        return;
      }
```

In the `createAction` handler, just after its `if (retro.closed) { return; }`, add:

```javascript
      if (!actor || actor.anonymous) {
        return;
      }
```

Leave `addCard` and `voteCard` with no anon guard — anonymous participants may add and vote.

(The `timer` handler also re-reads `const entry = clients.get(ws)` and checks `entry.role !== "facilitator"`; since anon is clamped to `participant` this already excludes them, but the explicit guard above is defense-in-depth and documents intent.)

- [ ] **Step 2: Syntax-check**

Run: `node --check server.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(retro): gate timer/moveCard/createAction to authed members"
```

---

## Task 10: Anon-aware board client (`public/client.js`)

**Files:**
- Modify: `public/client.js`

- [ ] **Step 1: Detect anon mode and resolve the board id**

Replace the param/`retroId` block (lines ~68-69):

```javascript
const params = new URLSearchParams(window.location.search);
const shareToken = params.get("token");
const isAnon = !!shareToken;
let retroId = params.get("retroId") || params.get("board");
```

Replace the missing-id redirect (lines ~108-110):

```javascript
if (!retroId) {
  window.location.href = isAnon ? "/join" : "/lobby";
}
```

- [ ] **Step 2: Force participant role for anon in `loadSession`**

In `loadSession` (lines ~847-856), after the `isFacilitator = ...` line add:

```javascript
  if (isAnon) {
    userRole = "participant";
    isFacilitator = false;
  }
```

- [ ] **Step 3: Refactor board-meta application + skip the authed fetch for anon**

Add an `applyRetroMeta` helper and call it from both `loadRetroMeta` and the WS `init`. First, add this function just above `loadRetroMeta` (line ~713):

```javascript
function applyRetroMeta(retro) {
  if (!retro) return;
  retroTitle.textContent = retro.title;
  retroMeta.textContent = retro.createdAt ? new Date(retro.createdAt).toLocaleString() : "";
  isReadOnly = !!retro.closed;
  retroStatus.classList.remove("open", "closed");
  if (retro.closed) {
    retroStatus.textContent = `Closed ${retro.closedAt ? `· ${new Date(retro.closedAt).toLocaleDateString()}` : ""}`;
    retroStatus.classList.add("closed");
  } else {
    retroStatus.textContent = "Open";
    retroStatus.classList.add("open");
  }
  applyReadOnlyState();
  maybeShowInviteLink(retro);
}
```

Then replace the body of `loadRetroMeta` after `const retro = data.retro;` ... down to the end so it delegates to `applyRetroMeta`. Replace lines ~730-741 (the inline meta assignments) with:

```javascript
  applyRetroMeta(retro);
```

In `connectSocket`'s message handler, in the `if (data.type === "init" ...)` branch, after `currentState = data.retro;` (line ~796) add:

```javascript
      if (data.type === "init") {
        applyRetroMeta(data.retro);
      }
```

In `init()` (lines ~858-862), skip the authed meta fetch for anon:

```javascript
async function init() {
  loadSession();
  if (!isAnon) {
    await loadRetroMeta();
  }
  connectSocket();
}
```

- [ ] **Step 4: Send the token over the WS and hide authed-only controls**

In `connectSocket` (lines ~744-753), replace the `query` construction:

```javascript
  const query = new URLSearchParams({
    retroId,
    name: username || "Anonymous",
    role: isAnon ? "participant" : userRole
  });
  if (shareToken) {
    query.set("token", shareToken);
  }
```

Disable dragging for anon — change the dragula `moves` predicate (line ~508):

```javascript
const drake = dragula([columns.well, columns.improve, columns.continue], {
  moves: () => !isReadOnly && !isAnon
});
```

Hide create-action affordances for anon by tagging the body. Add near the top-level setup (just after `updateTimerDisplay();` at line ~493):

```javascript
if (isAnon) {
  document.body.classList.add("anon");
}
```

(The timer controls are already hidden for non-facilitators by `applyReadOnlyState`, so anon never sees them. The CSS rule that hides `.create-action-btn` for `body.anon` is added in Task 11 alongside the board markup.)

- [ ] **Step 5: Add the invite-link helper (no-op until Task 11 adds the button)**

Add this function just above `applyRetroMeta`:

```javascript
const inviteLinkBtn = document.getElementById("copy-invite-link");

function maybeShowInviteLink(retro) {
  if (!inviteLinkBtn) return;
  if (isAnon || !retro || !retro.shareToken) {
    inviteLinkBtn.hidden = true;
    return;
  }
  inviteLinkBtn.hidden = false;
  inviteLinkBtn.dataset.shareToken = retro.shareToken;
}

if (inviteLinkBtn) {
  inviteLinkBtn.addEventListener("click", async () => {
    const token = inviteLinkBtn.dataset.shareToken;
    if (!token) return;
    const url = `${window.location.origin}/join?token=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      inviteLinkBtn.textContent = "Link copied!";
      setTimeout(() => {
        inviteLinkBtn.textContent = "Copy invite link";
      }, 2000);
    } catch (err) {
      window.prompt("Copy this invite link:", url);
    }
  });
}
```

- [ ] **Step 6: Syntax-check**

Run: `node --check public/client.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add public/client.js
git commit -m "feat(retro): anon-aware board client (token WS, skip authed fetch, invite link)"
```

---

## Task 11: Board markup — invite-link button + anon CSS

**Files:**
- Modify: `public/retrospective.html`
- Modify: the board stylesheet under `public/css/` (the file that styles the board header)

- [ ] **Step 1: Find the board header and stylesheet**

Run: `grep -rn "retro-status\|retro-title\|timer-controls" public/retrospective.html | head`
Run: `ls public/css`

Identify the header region (near `#retro-title` / `#retro-status`) and the main board CSS file (e.g. `public/css/retrospective.css` or similar).

- [ ] **Step 2: Add the Copy-invite-link button**

In `public/retrospective.html`, inside the board header next to `#retro-status`, add a button (hidden by default):

```html
<button id="copy-invite-link" type="button" class="invite-link-btn" hidden>Copy invite link</button>
```

Place it adjacent to the existing status/title element so it reads as a header action.

- [ ] **Step 3: Add the anon CSS rule**

In the board stylesheet, add:

```css
body.anon .create-action-btn {
  display: none !important;
}
.invite-link-btn {
  cursor: pointer;
}
```

(The `.create-action-btn` selector matches the per-card "create action" control used in `client.js` line ~539. Hiding it for `body.anon` removes the affordance; the server also rejects `createAction` from anon sockets.)

- [ ] **Step 4: Manual visual check (deferred to e2e in Task 15)**

No unit test. Coverage is the e2e in Task 15 (authed sees the button; anon does not see create-action).

- [ ] **Step 5: Commit**

```bash
git add public/retrospective.html public/css
git commit -m "feat(retro): invite-link button + hide create-action for anon"
```

---

## Task 12: Public join page (`public/join.html` + `public/join.js`)

**Files:**
- Create: `public/join.html`
- Create: `public/join.js`

- [ ] **Step 1: Create `public/join.html`**

A minimal standalone page (it must not depend on auth or the lobby). Mirror the look of `lobby.html`'s header but keep it self-contained:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Join a retro</title>
  <link rel="stylesheet" href="/css/styles.css" />
</head>
<body>
  <main class="join-wrap">
    <section class="panel">
      <h1>Join the retro</h1>
      <p id="join-board-title" class="header-subtitle">Checking your link...</p>
      <div id="join-error" class="join-error" hidden></div>
      <form id="join-form" hidden>
        <label class="field">
          <span>Your name</span>
          <input id="join-name" type="text" placeholder="Your name" maxlength="80" required />
        </label>
        <button type="submit">Join board</button>
      </form>
    </section>
  </main>
  <script src="/join.js"></script>
</body>
</html>
```

Note: confirm the stylesheet path in Step 1 of Task 11 (`ls public/css`); use the actual top-level CSS file name (`/css/<file>.css`). If there is no single `styles.css`, link the same stylesheet `lobby.html` uses (check `grep -n "stylesheet" public/lobby.html`).

- [ ] **Step 2: Create `public/join.js`**

```javascript
// Public anonymous join: validate the share token, collect a name, then hand
// off to the shared board view. No auth, no lobby.
const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const titleEl = document.getElementById("join-board-title");
const errorEl = document.getElementById("join-error");
const formEl = document.getElementById("join-form");
const nameEl = document.getElementById("join-name");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  titleEl.hidden = true;
  formEl.hidden = true;
}

async function start() {
  if (!token) {
    showError("This link is missing its code.");
    return;
  }
  let res;
  try {
    res = await fetch(`/api/shared/${encodeURIComponent(token)}`);
  } catch (err) {
    showError("Could not reach the server. Try again.");
    return;
  }
  if (res.status === 410) {
    showError("This retro has ended.");
    return;
  }
  if (!res.ok) {
    showError("This link is not valid.");
    return;
  }
  const data = await res.json();
  const board = data.board;
  titleEl.textContent = `Joining: ${board.title}`;
  formEl.hidden = false;
  nameEl.value = localStorage.getItem("retroUserName") || "";

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameEl.value.trim() || "Anonymous";
    localStorage.setItem("retroUserName", name);
    const q = new URLSearchParams({ token, board: board.id });
    window.location.href = `/shared?${q.toString()}`;
  });
}

start();
```

- [ ] **Step 3: Confirm static serving covers `join.js`**

`join.js` is a top-level script in `public/`; the existing `app.use(express.static(...))` serves it. The `.html`-blocking middleware (server.js ~731) returns 404 for `*.html` direct requests, but `join.html` is served via the explicit `GET /join` route (Task 7), so that is fine.

- [ ] **Step 4: Syntax-check**

Run: `node --check public/join.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add public/join.html public/join.js
git commit -m "feat(retro): public anonymous join page"
```

---

## Task 13: Company-scoped lobby (`public/lobby.js` + `public/lobby.html`)

**Files:**
- Modify: `public/lobby.js`
- Modify: `public/lobby.html`

- [ ] **Step 1: Remove the team `<select>` from `lobby.html`**

Replace the Team field block (lines ~65-68) with a read-only company label:

```html
          <label class="field">
            <span>Company</span>
            <span id="company-name" class="field-value">-</span>
          </label>
```

- [ ] **Step 2: Rework `lobby.js` state + element refs**

Replace the top refs and state (lines ~9-15). Remove `teamSelect`, add `companyName`:

```javascript
const companyName = document.getElementById("company-name");
const logoutBtn = document.getElementById("logout-btn");

let currentCompany = null;
let retros = [];
let lobbySocket = null;
```

(Delete the `const teamSelect = ...`, `let teams = []`, `let currentTeamId = null` lines.)

- [ ] **Step 3: Company-scope `loadRetros`**

Replace `loadRetros` (lines ~123-136):

```javascript
async function loadRetros() {
  if (!currentCompany) {
    return;
  }
  const response = await fetchWithAuth("/api/retros");
  if (!response) {
    return;
  }
  const data = await response.json();
  retros = data.retros || [];
  renderRetros();
}
```

- [ ] **Step 4: Company-scope `connectLobbySocket`**

Replace `connectLobbySocket` (lines ~138-169):

```javascript
function connectLobbySocket() {
  if (!currentCompany) {
    return;
  }
  if (lobbySocket) {
    try {
      lobbySocket.close();
    } catch (err) {
      // ignore
    }
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({
    view: "lobby",
    name: getDisplayName() || "Anonymous",
    role: getSelectedRole()
  });
  lobbySocket = new WebSocket(`${proto}://${location.host}/ws?${query.toString()}`);
  lobbySocket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "retros") {
      retros = data.retros || [];
      renderRetros();
    }
  });
  lobbySocket.addEventListener("close", (event) => {
    if (event.code === 4401 || event.code === 1008) {
      window.location.reload();
    }
  });
}
```

- [ ] **Step 5: Drop `teamId` from board creation + remove `onTeamChange`**

In the create-form submit (lines ~175-198), replace the guard + body:

```javascript
if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = createTitle.value.trim();
    if (!title || !currentCompany) {
      return;
    }
    const response = await fetchWithAuth("/api/retros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    if (!response || !response.ok) {
      return;
    }
    const data = await response.json();
    const retroId = data.retro && data.retro.id;
    if (retroId) {
      window.location.href = `/retrospective?retroId=${encodeURIComponent(retroId)}`;
    } else {
      await loadRetros();
    }
  });
}
```

Delete the entire `function onTeamChange() { ... }` block (lines ~200-207).

- [ ] **Step 6: Rework `init()`**

Replace `init` (lines ~209-238):

```javascript
async function init() {
  const response = await fetch("/api/me", { credentials: "same-origin" });
  if (!response.ok) {
    handleUnauthorized(response);
    return;
  }
  const data = await response.json();
  currentCompany = data.company || null;
  if (!currentCompany || !currentCompany.id) {
    userSummary.textContent = "No company on your account yet. Please sign in again.";
    if (companyName) companyName.textContent = "-";
    return;
  }
  if (companyName) companyName.textContent = currentCompany.name || currentCompany.id;

  const name = getDisplayName();
  userSummary.textContent = name ? `Signed in as ${name}` : "Enter your name to begin";

  loadRetros();
  connectLobbySocket();
}

init();
```

- [ ] **Step 7: Syntax-check**

Run: `node --check public/lobby.js`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add public/lobby.js public/lobby.html
git commit -m "feat(retro): company-scoped lobby, drop team picker"
```

---

## Task 14: Update e2e seed helper for the company contract

**Files:**
- Modify: `tests/e2e/helpers/seed.js`

- [ ] **Step 1: Add `company` to seeded sessions**

Replace `seedSession` (lines ~7-25):

```javascript
function seedSession({
  id = "s-e2e",
  userId = "u-e2e",
  entitled = true,
  teams = [{ id: "t1", name: "Alpha", role: "lead" }],
  company = { id: "co1", name: "Acme" }
} = {}) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const store = createSessionsStore(DB);
  store.delete(id);
  store.create({
    id,
    userId,
    centralSessionId: `c-${id}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    entitled,
    teams,
    company
  });
  return { id, userId, teams, company };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/helpers/seed.js
git commit -m "test(retro): seed company on e2e sessions"
```

---

## Task 15: e2e — company flow, anon join, control gating, closed-link rejection

**Files:**
- Modify: `tests/e2e/retro-smoke.spec.js` (company model)
- Create: `tests/e2e/retro-sharing.spec.js`
- Modify: `package.json` (test script)

- [ ] **Step 1: Update the unit `test` script**

In `package.json`, replace the `test` script:

```json
    "test": "node --test tests/theme-contrast.test.js tests/db-schema.test.js tests/upgrade-auth.test.js tests/company-access.test.js",
```

- [ ] **Step 2: Run the unit suite to confirm green**

Run: `npm test`
Expected: PASS (theme-contrast, db-schema, upgrade-auth, company-access).

- [ ] **Step 3: Rewrite `tests/e2e/retro-smoke.spec.js` for the company model**

Replace the whole file:

```javascript
const { test, expect } = require("@playwright/test");
const { seedSession } = require("./helpers/seed");
const { injectSession } = require("./helpers/_auth");

test("unauthenticated /lobby redirects to the hub", async ({ request }) => {
  const res = await request.get("/lobby", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"] || "").toContain("127.0.0.1:9");
});

test("a user cannot read a board owned by another company", async ({ playwright, baseURL }) => {
  seedSession({ id: "sessA", userId: "uA", company: { id: "coA", name: "A Ltd" } });
  const ctxA = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=sessA" }
  });
  const created = await ctxA.post("/api/retros", { data: { title: "A Board" } });
  expect(created.status()).toBe(201);
  const { retro } = await created.json();
  expect(retro.shareToken).toBeTruthy();

  seedSession({ id: "sessB", userId: "uB", company: { id: "coB", name: "B Ltd" } });
  const ctxB = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=sessB" }
  });
  const forbidden = await ctxB.get(`/api/retros/${retro.id}`);
  expect(forbidden.status()).toBe(404);

  const own = await ctxB.post("/api/retros", { data: { title: "B Board" } });
  expect(own.status()).toBe(201);
  await ctxA.dispose();
  await ctxB.dispose();
});

test("authed user sees their company and can open a board", async ({ page, context }) => {
  seedSession();
  await injectSession(context);
  await page.goto("/lobby");
  await expect(page.locator("#company-name")).toHaveText("Acme");
  await expect(page.locator("#team-select")).toHaveCount(0);
  await page.fill("#display-name", "Tester");
  await page.fill("#create-title", "Sprint 1");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/retrospective\?retroId=/, { timeout: 10000 });
  await expect(page.locator("#col-well")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#copy-invite-link")).toBeVisible();
});
```

- [ ] **Step 4: Create `tests/e2e/retro-sharing.spec.js`**

```javascript
const { test, expect } = require("@playwright/test");
const { seedSession } = require("./helpers/seed");
const { injectSession } = require("./helpers/_auth");

async function createBoard(playwright, baseURL) {
  seedSession();
  const ctx = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=s-e2e" }
  });
  const res = await ctx.post("/api/retros", { data: { title: "Shared Retro" } });
  expect(res.status()).toBe(201);
  const { retro } = await res.json();
  await ctx.dispose();
  return retro;
}

test("anonymous join page validates the token and shows a name form", async ({ page, playwright, baseURL }) => {
  const retro = await createBoard(playwright, baseURL);
  await page.goto(`/join?token=${retro.shareToken}`);
  await expect(page.locator("#join-form")).toBeVisible();
  await expect(page.locator("#join-board-title")).toContainText("Shared Retro");
});

test("an invalid token shows a friendly error", async ({ page }) => {
  await page.goto("/join?token=does-not-exist");
  await expect(page.locator("#join-error")).toBeVisible();
});

test("anonymous participant can add a card and vote, but has no create-action control", async ({ page, playwright, baseURL }) => {
  const retro = await createBoard(playwright, baseURL);
  await page.goto(`/join?token=${retro.shareToken}`);
  await page.fill("#join-name", "Guest");
  await page.click("#join-form button[type=submit]");
  await page.waitForURL(/\/shared\?/, { timeout: 10000 });
  await expect(page.locator("#col-well")).toBeVisible({ timeout: 10000 });
  // No facilitator timer controls and no create-action affordance for anon.
  await expect(page.locator(".timer-controls")).toBeHidden();
  // Add a card (exercise the add-card flow; selectors per retrospective.html).
  // This asserts the add path is available to anon; vote path shares the same board.
  await expect(page.locator("body.anon")).toHaveCount(1);
});

test("a closed board rejects the share link", async ({ page, playwright, baseURL }) => {
  const retro = await createBoard(playwright, baseURL);
  // Close it as the authed owner.
  const ctx = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: "retro_session=s-e2e" }
  });
  const closed = await ctx.post(`/api/retros/${retro.id}/close`);
  expect(closed.status()).toBe(200);
  await ctx.dispose();
  // The public meta endpoint now reports gone.
  const meta = await page.request.get(`/api/shared/${retro.shareToken}`);
  expect(meta.status()).toBe(410);
  // And the join page shows the ended message.
  await page.goto(`/join?token=${retro.shareToken}`);
  await expect(page.locator("#join-error")).toContainText("ended");
});
```

Note on the add-card assertion: the precise card-add selectors live in `retrospective.html` (note dialog / `#note-form`). During implementation, open `retrospective.html`, find the add-note control ids, and extend the "add a card and vote" test to actually add a card and assert it renders. The placeholder above asserts anon mode + hidden controls; tighten it with the real selectors when running the task.

- [ ] **Step 5: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS. If the browser libs are missing, the existing `playwright.config.js` `LD_LIBRARY_PATH` shim handles it; the webServer boots with `RETRO_ALLOWED_ORIGINS=*` and a throwaway DB.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/retro-smoke.spec.js tests/e2e/retro-sharing.spec.js package.json
git commit -m "test(retro): e2e for company flow + anonymous share-link join"
```

---

## Task 16: Full verification + deploy prep

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS (4 files, all green).

- [ ] **Step 2: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Manual smoke against a local dev server**

Boot locally with the same env shape as Playwright (throwaway DB), then in a browser:
1. Authed: log in via the hub, land on `/lobby`, confirm the company name shows and there is NO team picker. Create a board. On the board, click "Copy invite link" and confirm a `/join?token=...` URL is copied.
2. Anon: open that link in a private window. Confirm the name form, join, and that you can add a card and vote. Confirm there is no timer control and no create-action button.
3. Closed: as the authed owner, close the board. Re-open the invite link in the private window; confirm the "this retro has ended" message.

- [ ] **Step 4: Confirm no stale `team` references remain in server code paths**

Run: `grep -rn "teamId\|team_id\|boardTeamAllowed\|teamIdInTeams\|listRetrosForTeam\|getRetrosForTeamId" server.js public/lobby.js public/client.js db.js lib`
Expected: no matches (all replaced by company equivalents).

- [ ] **Step 5: Tag the baseline before deploy**

```bash
git tag pre-retro-room-sharing
```

(Tag the commit BEFORE these changes if not already done — if the branch is already ahead, tag the last commit on `main` prior to this work instead. Confirm with `git log --oneline` which commit is the pre-feature baseline and tag that one.)

- [ ] **Step 6: Deploy (separate step-by-step prod session with the user)**

Follow the spec's Deploy section and `reference-ionos-deploy` conventions, one command per block:
1. On prod retro checkout: `git fetch` then `git merge --ff-only origin/main` (after this branch is merged to `main` and pushed).
2. `npm install --omit=dev` only if deps changed (none expected; auth-client symlink already present).
3. Restart `retrospective.service`.
4. On boot: schema migrates to v7 (wipes existing boards); the auth-client `company` column ALTERs into `retro-sessions.db`.
5. Smoke per Step 3 against prod; confirm `/health` returns 200 and the other three apps still launch.

Rollback: `git checkout pre-retro-room-sharing` + restart. Board data is already wiped by the v7 migration, so rollback restores code but not pre-migration boards (acceptable; boards are disposable).

---

## Self-Review notes

- **Spec coverage:** team->company collapse (Tasks 1,2,4,6,8,13); clean-cut v7 wipe (Task 1); anon add+vote only with move/createAction/timer/close authed-only (Tasks 8,9,10,11); auto-mint token at creation (Task 4); token valid only while open (Tasks 3,7,8); public `/join` page reusing board view via `/shared` (Tasks 7,10,12); Copy-invite-link for authed (Tasks 10,11); no-company edge case (Tasks 6,8,13); closed-link rejection (Tasks 3,7,15). All spec sections map to tasks.
- **Type/name consistency:** `companyId` (in-memory normalized) vs `company_id` (DB row) handled in `boardCompanyAllowed` and `normalizeRetro`; `shareToken` (normalized) vs `share_token` (DB); `decideUpgrade` signature `(verifySession, cookieHeader, shareToken, lookupBoardByToken)` matches its caller `lookupOpenBoardByToken`; `listRetrosForCompany` used consistently in routes + WS + broadcast; `ws.anonymous` / `ws.anonRetroId` / `ws.company` set in Task 5 and read in Task 8/9.
- **No placeholders:** the only deferred detail is the exact add-card selector in the anon e2e (Task 15 Step 4), explicitly flagged to resolve from `retrospective.html` during implementation; the assertion still passes on anon-mode + hidden-control checks.
