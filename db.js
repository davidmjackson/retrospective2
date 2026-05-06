const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

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

function openDatabase(dbFile) {
  const db = new Database(dbFile);
  db.pragma("foreign_keys = ON");
  return db;
}

function createTeamsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    join_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name)");
}

function generateTeamKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 5; i += 1) {
    key += chars[crypto.randomInt(chars.length)];
  }
  return key;
}

function getTeamByName(db, name) {
  const safeName = typeof name === "string" ? name.trim() : "";
  if (!safeName) {
    return null;
  }
  return db
    .prepare("SELECT id, name, join_key FROM teams WHERE name = ? COLLATE NOCASE")
    .get(safeName);
}

function getTeamById(db, teamId) {
  const id = Number.parseInt(teamId, 10);
  if (!Number.isFinite(id)) {
    return null;
  }
  return db.prepare("SELECT id, name, join_key FROM teams WHERE id = ?").get(id);
}

function createTeam(db, name) {
  const safeName = typeof name === "string" ? name.trim() : "";
  if (!safeName) {
    throw new Error("Team name is required.");
  }
  const insert = db.prepare(
    "INSERT INTO teams (name, join_key, created_at) VALUES (?, ?, ?)"
  );
  const now = new Date().toISOString();
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const key = generateTeamKey();
    try {
      insert.run(safeName, key, now);
      return { name: safeName, joinKey: key };
    } catch (err) {
      lastError = err;
      if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        if (String(err.message || "").includes("teams.name")) {
          const exists = new Error("Team already exists.");
          exists.code = "TEAM_EXISTS";
          throw exists;
        }
        continue;
      }
      throw err;
    }
  }
  if (lastError) {
    throw lastError;
  }
  const failure = new Error("Unable to generate a unique team key.");
  failure.code = "KEY_GENERATION_FAILED";
  throw failure;
}

function backfillTeamsFromRetros(db) {
  const teams = db.prepare("SELECT DISTINCT team FROM retros").all();
  teams.forEach((row) => {
    const teamName = row && row.team ? String(row.team).trim() : "";
    if (!teamName) {
      return;
    }
    const existing = getTeamByName(db, teamName);
    if (existing) {
      return;
    }
    try {
      createTeam(db, teamName);
    } catch (err) {
      if (err && err.code === "TEAM_EXISTS") {
        return;
      }
      throw err;
    }
  });
}

function ensureAdminTeam(db, adminKey) {
  const safeKey = typeof adminKey === "string" ? adminKey.trim().toLowerCase() : "";
  if (!safeKey || !/^[a-z0-9]{5}$/.test(safeKey)) {
    throw new Error("Admin key must be 5 lowercase letters or digits.");
  }
  const existing = getTeamByName(db, "Admin");
  if (!existing) {
    const insert = db.prepare(
      "INSERT INTO teams (name, join_key, created_at) VALUES (?, ?, ?)"
    );
    insert.run("Admin", safeKey, new Date().toISOString());
    return { name: "Admin", joinKey: safeKey, created: true };
  }
  if (existing.join_key !== safeKey) {
    const update = db.prepare("UPDATE teams SET join_key = ? WHERE id = ?");
    update.run(safeKey, existing.id);
    return { name: "Admin", joinKey: safeKey, updated: true };
  }
  return { name: "Admin", joinKey: safeKey, updated: false };
}

function listTeams(db) {
  return db
    .prepare("SELECT id, name, join_key, created_at FROM teams ORDER BY name COLLATE NOCASE")
    .all();
}

function deleteTeamById(db, teamId) {
  const id = Number.parseInt(teamId, 10);
  if (!Number.isFinite(id)) {
    return null;
  }
  const team = db.prepare("SELECT id, name FROM teams WHERE id = ?").get(id);
  if (!team) {
    return null;
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM retros WHERE team = ? COLLATE NOCASE").run(team.name);
    db.prepare("DELETE FROM teams WHERE id = ?").run(team.id);
  });
  tx();
  return team;
}

function createNormalizedSchema(db, tables) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${tables.retros} (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    team TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed INTEGER NOT NULL,
    closed_at TEXT,
    timer_duration_seconds INTEGER NOT NULL,
    timer_remaining_seconds INTEGER NOT NULL,
    timer_running INTEGER NOT NULL,
    timer_end_at INTEGER,
    last_action_json TEXT,
    updated_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS ${tables.cards} (
    id TEXT PRIMARY KEY,
    retro_id TEXT NOT NULL,
    column_type TEXT NOT NULL,
    text TEXT NOT NULL,
    details TEXT,
    votes INTEGER NOT NULL,
    status TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (retro_id) REFERENCES ${tables.retros}(id) ON DELETE CASCADE
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_${tables.cards}_retro ON ${tables.cards}(retro_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_${tables.cards}_retro_column ON ${tables.cards}(retro_id, column_type)`
  );
}

function collectCards(retro) {
  const cards = [];
  ["well", "improve", "action"].forEach((column) => {
    (retro.columns[column] || []).forEach((card) => {
      cards.push({
        id: card.id,
        columnType: column,
        text: card.text,
        details: card.details || "",
        votes: Number.isFinite(card.votes) ? card.votes : 0,
        status: column === "action" ? card.status || "todo" : null,
        notes: column === "action" ? card.notes || "" : null
      });
    });
  });
  return cards;
}

function runRetroUpsert(db, tableName, retro, timestamp) {
  const normalized = normalizeRetro(retro);
  const retroStmt = db.prepare(
    `INSERT INTO ${tableName} (
      id,
      title,
      team,
      created_at,
      closed,
      closed_at,
      timer_duration_seconds,
      timer_remaining_seconds,
      timer_running,
      timer_end_at,
      last_action_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      team = excluded.team,
      created_at = excluded.created_at,
      closed = excluded.closed,
      closed_at = excluded.closed_at,
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
    normalized.team,
    normalized.createdAt,
    normalized.closed ? 1 : 0,
    normalized.closedAt,
    normalized.timer.durationSeconds,
    normalized.timer.remainingSeconds,
    normalized.timer.running ? 1 : 0,
    normalized.timer.endAt,
    normalized.lastAction ? JSON.stringify(normalized.lastAction) : null,
    timestamp
  );

  return normalized;
}

function normalizeCardForPersistence(card, columnType) {
  return {
    id: card.id,
    columnType,
    text: card.text,
    details: card.details || "",
    votes: Number.isFinite(card.votes) ? card.votes : 0,
    status: columnType === "action" ? card.status || "todo" : null,
    notes: columnType === "action" ? card.notes || "" : null
  };
}

function runCardUpsert(db, tableName, retroId, columnType, card, timestamp) {
  const normalized = normalizeCardForPersistence(card, columnType);
  const cardStmt = db.prepare(
    `INSERT INTO ${tableName} (
      id,
      retro_id,
      column_type,
      text,
      details,
      votes,
      status,
      notes,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      retro_id = excluded.retro_id,
      column_type = excluded.column_type,
      text = excluded.text,
      details = excluded.details,
      votes = excluded.votes,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at`
  );

  cardStmt.run(
    normalized.id,
    retroId,
    normalized.columnType,
    normalized.text,
    normalized.details,
    normalized.votes,
    normalized.status,
    normalized.notes,
    timestamp
  );
}

function saveRetro(db, retro, callback) {
  try {
    runRetroUpsert(db, "retros", retro, new Date().toISOString());
    callback();
  } catch (err) {
    callback(err);
  }
}

function saveRetroCard(db, retro, columnType, card, callback) {
  try {
    const timestamp = new Date().toISOString();
    const tx = db.transaction(() => {
      const normalized = runRetroUpsert(db, "retros", retro, timestamp);
      runCardUpsert(db, "cards", normalized.id, columnType, card, timestamp);
    });
    tx();
    callback();
  } catch (err) {
    callback(err);
  }
}

function saveRetroTimer(db, retro, callback) {
  try {
    const normalized = normalizeRetro(retro);
    db.prepare(
      `UPDATE retros SET
        timer_duration_seconds = ?,
        timer_remaining_seconds = ?,
        timer_running = ?,
        timer_end_at = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      normalized.timer.durationSeconds,
      normalized.timer.remainingSeconds,
      normalized.timer.running ? 1 : 0,
      normalized.timer.endAt,
      new Date().toISOString(),
      normalized.id
    );
    callback();
  } catch (err) {
    callback(err);
  }
}

function saveRetros(db, retros, callback, options = {}) {
  try {
    const tables = options.tables || { retros: "retros", cards: "cards" };
    const deleteExisting = options.deleteExisting !== false;
    const timestamp = new Date().toISOString();

    const deleteStmt = deleteExisting
      ? db.prepare(`DELETE FROM ${tables.cards} WHERE retro_id = ?`)
      : null;
    const cardStmt = db.prepare(
      `INSERT INTO ${tables.cards} (
        id,
        retro_id,
        column_type,
        text,
        details,
        votes,
        status,
        notes,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      retros.forEach((retro) => {
        const normalized = runRetroUpsert(db, tables.retros, retro, timestamp);
        if (deleteStmt) {
          deleteStmt.run(normalized.id);
        }
        const cards = collectCards(normalized);
        cards.forEach((card) => {
          cardStmt.run(
            card.id,
            normalized.id,
            card.columnType,
            card.text,
            card.details,
            card.votes,
            card.status,
            card.notes,
            timestamp
          );
        });
      });
    });

    tx();
    callback();
  } catch (err) {
    callback(err);
  }
}

function migrateLegacyJsonTable(db, callback) {
  try {
    const tempTables = { retros: "retros_v2", cards: "cards_v2" };
    createNormalizedSchema(db, tempTables);
    const rows = db.prepare("SELECT data_json FROM retros").all();
    const retros = [];
    rows.forEach((row) => {
      if (!row || !row.data_json) {
        return;
      }
      try {
        const parsed = JSON.parse(row.data_json);
        if (parsed && Array.isArray(parsed.retros)) {
          parsed.retros.forEach((retro) => retros.push(normalizeRetro(retro)));
        } else if (parsed) {
          retros.push(normalizeRetro(parsed));
        }
      } catch (parseErr) {
        return;
      }
    });

    saveRetros(
      db,
      retros,
      (saveErr) => {
        if (saveErr) {
          callback(saveErr);
          return;
        }
        const tx = db.transaction(() => {
          db.exec("DROP TABLE retros");
          db.exec("ALTER TABLE retros_v2 RENAME TO retros");
          db.exec("ALTER TABLE cards_v2 RENAME TO cards");
          db.exec("CREATE INDEX IF NOT EXISTS idx_cards_retro ON cards(retro_id)");
          db.exec(
            "CREATE INDEX IF NOT EXISTS idx_cards_retro_column ON cards(retro_id, column_type)"
          );
        });
        tx();
        callback();
      },
      { tables: tempTables }
    );
  } catch (err) {
    callback(err);
  }
}

function ensureSchema(db, callback) {
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get();
    const version = row ? Number.parseInt(row.value, 10) : 0;
    if (version >= 2) {
      createNormalizedSchema(db, { retros: "retros", cards: "cards" });
      createTeamsSchema(db);
      backfillTeamsFromRetros(db);
      if (version < 3) {
        db.exec(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')"
        );
      }
      callback();
      return;
    }
    const cols = db.prepare("PRAGMA table_info(retros)").all();
    const hasLegacyJson = Array.isArray(cols)
      ? cols.some((col) => col.name === "data_json")
      : false;
    if (hasLegacyJson) {
      migrateLegacyJsonTable(db, (err) => {
        if (err) {
          callback(err);
          return;
        }
        createTeamsSchema(db);
        backfillTeamsFromRetros(db);
        db.exec(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')"
        );
        callback();
      });
      return;
    }
    createNormalizedSchema(db, { retros: "retros", cards: "cards" });
    createTeamsSchema(db);
    backfillTeamsFromRetros(db);
    db.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')"
    );
    callback();
  } catch (err) {
    callback(err);
  }
}

function loadRetros(db, callback) {
  try {
    const retroRows = db.prepare("SELECT * FROM retros").all();
    if (!retroRows || retroRows.length === 0) {
      callback(null, []);
      return;
    }
    const cardRows = db.prepare("SELECT * FROM cards").all();
    const cardsByRetro = new Map();
    (cardRows || []).forEach((card) => {
      if (!cardsByRetro.has(card.retro_id)) {
        cardsByRetro.set(card.retro_id, []);
      }
      cardsByRetro.get(card.retro_id).push(card);
    });

    const retros = retroRows.map((row) => {
      const columns = { well: [], improve: [], action: [] };
      const cards = cardsByRetro.get(row.id) || [];
      cards.forEach((card) => {
        if (!columns[card.column_type]) {
          return;
        }
        const mapped = {
          id: card.id,
          text: card.text,
          details: card.details || "",
          votes: Number.isFinite(card.votes) ? card.votes : 0
        };
        if (card.column_type === "action") {
          mapped.status = card.status || "todo";
          mapped.notes = card.notes || "";
        }
        columns[card.column_type].push(mapped);
      });

      let lastAction = null;
      if (row.last_action_json) {
        try {
          lastAction = JSON.parse(row.last_action_json);
        } catch (parseErr) {
          lastAction = null;
        }
      }

      return normalizeRetro({
        id: row.id,
        title: row.title,
        team: row.team,
        createdAt: row.created_at,
        closed: Boolean(row.closed),
        closedAt: row.closed_at,
        columns,
        timer: {
          durationSeconds: row.timer_duration_seconds,
          remainingSeconds: row.timer_remaining_seconds,
          running: Boolean(row.timer_running),
          endAt: row.timer_end_at
        },
        lastAction
      });
    });
    callback(null, retros);
  } catch (err) {
    callback(err);
  }
}

function loadRetrosFromJsonFile(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.retros)) {
      return parsed.retros.map(normalizeRetro);
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
      return [migrated];
    }
  } catch (err) {
    return null;
  }
  return null;
}

function seedFromJsonIfPresent(db, stateFile, callback) {
  try {
    const retros = loadRetrosFromJsonFile(stateFile);
    if (!retros || retros.length === 0) {
      callback(null, []);
      return;
    }
    saveRetros(db, retros, (err) => {
      if (err) {
        callback(err);
        return;
      }
      callback(null, retros);
    });
  } catch (err) {
    callback(err);
  }
}

function applyRetention(db, days, callback) {
  try {
    if (!Number.isFinite(days) || days <= 0) {
      callback(null);
      return;
    }
    const cutoff = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        "DELETE FROM cards WHERE retro_id IN (SELECT id FROM retros WHERE closed = 1 AND closed_at IS NOT NULL AND closed_at < ?)"
      ).run(cutoff);
      db.prepare(
        "DELETE FROM retros WHERE closed = 1 AND closed_at IS NOT NULL AND closed_at < ?"
      ).run(cutoff);
    });
    tx();
    callback(null);
  } catch (err) {
    callback(err);
  }
}

module.exports = {
  defaultTimer,
  defaultColumns,
  normalizeActionCard,
  normalizeColumns,
  normalizeTimer,
  normalizeRetro,
  openDatabase,
  ensureSchema,
  loadRetros,
  saveRetro,
  saveRetroCard,
  saveRetroTimer,
  saveRetros,
  seedFromJsonIfPresent,
  applyRetention,
  getTeamByName,
  getTeamById,
  createTeam,
  backfillTeamsFromRetros,
  ensureAdminTeam,
  listTeams,
  deleteTeamById
};
