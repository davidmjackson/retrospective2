// tests/db-schema.test.js
const test = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");
const { ensureSchema, createRetroRow, getRetrosForTeamId, getRetroById } = require("../db");

function freshDb() {
  return new Promise((resolve, reject) => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db, (err) => (err ? reject(err) : resolve(db)));
  });
}

test("retros table has a NOT NULL team_id and no shared-key teams table", async () => {
  const db = await freshDb();
  const retroCols = db.prepare("PRAGMA table_info(retros)").all();
  const teamIdCol = retroCols.find((c) => c.name === "team_id");
  assert.ok(teamIdCol, "retros.team_id should exist");
  assert.strictEqual(teamIdCol.notnull, 1, "team_id should be NOT NULL");
  const teamsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'")
    .get();
  assert.strictEqual(teamsTable, undefined, "shared-key teams table should be dropped");
});

test("getRetrosForTeamId returns only that team's boards", async () => {
  const db = await freshDb();
  createRetroRow(db, { id: "r1", title: "A", teamId: "t1" });
  createRetroRow(db, { id: "r2", title: "B", teamId: "t2" });
  const t1 = getRetrosForTeamId(db, "t1");
  assert.deepStrictEqual(t1.map((r) => r.id), ["r1"]);
  const got = getRetroById(db, "r2");
  assert.strictEqual(got.team_id, "t2");
});

test("ensureSchema is idempotent on a v6 db", async () => {
  const db = await freshDb(); // v0 → v6
  createRetroRow(db, { id: "keep", title: "K", teamId: "t1" });
  await new Promise((res, rej) =>
    ensureSchema(db, (err) => (err ? rej(err) : res()))
  );
  const row = getRetroById(db, "keep");
  assert.ok(row, "row should survive a second ensureSchema call");
});
