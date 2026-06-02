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
