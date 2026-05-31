const fs = require("fs");
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
  continue: []
};

function normalizeActionItem(action) {
  return {
    id: action.id,
    sourceCardId: action.sourceCardId || action.source_card_id || null,
    text: action.text || "",
    details: action.details || "",
    owner: action.owner || "",
    dueDate: action.dueDate || action.due_date || "",
    status: action.status || "todo",
    notes: action.notes || "",
    createdAt: action.createdAt || action.created_at || new Date().toISOString(),
    createdBy: action.createdBy || action.created_by || ""
  };
}

function normalizeColumns(columns) {
  const cloneList = (list) =>
    Array.isArray(list)
      ? list.map((item) => {
          const card = { ...item };
          delete card.status;
          delete card.notes;
          return card;
        })
      : [];
  const continueCards = Array.isArray(columns.continue)
    ? columns.continue
    : columns.action;
  return {
    well: cloneList(columns.well),
    improve: cloneList(columns.improve),
    continue: cloneList(continueCards)
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
    teamId: retro.teamId || retro.team_id || "",
    createdAt: retro.createdAt || new Date().toISOString(),
    closed: Boolean(retro.closed),
    closedAt: retro.closedAt || null,
    columns: normalizeColumns(retro.columns || defaultColumns),
    actions: Array.isArray(retro.actions)
      ? retro.actions.map((action) => normalizeActionItem(action))
      : [],
    timer: normalizeTimer(retro.timer),
    lastAction: retro.lastAction || null
  };
}

function openDatabase(dbFile) {
  const db = new Database(dbFile);
  db.pragma("foreign_keys = ON");
  return db;
}

function createNormalizedSchema(db, tables) {
  const tableNames = {
    retros: tables.retros,
    cards: tables.cards,
    actions: tables.actions || "actions"
  };
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableNames.retros} (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    team_id TEXT NOT NULL,
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
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableNames.cards} (
    id TEXT PRIMARY KEY,
    retro_id TEXT NOT NULL,
    column_type TEXT NOT NULL,
    text TEXT NOT NULL,
    details TEXT,
    votes INTEGER NOT NULL,
    status TEXT,
    notes TEXT,
    created_by TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (retro_id) REFERENCES ${tableNames.retros}(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableNames.actions} (
    id TEXT PRIMARY KEY,
    retro_id TEXT NOT NULL,
    source_card_id TEXT,
    text TEXT NOT NULL,
    details TEXT,
    owner TEXT,
    due_date TEXT,
    status TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (retro_id) REFERENCES ${tableNames.retros}(id) ON DELETE CASCADE
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_${tableNames.cards}_retro ON ${tableNames.cards}(retro_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_${tableNames.cards}_retro_column ON ${tableNames.cards}(retro_id, column_type)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_${tableNames.actions}_retro ON ${tableNames.actions}(retro_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_${tableNames.actions}_retro_status ON ${tableNames.actions}(retro_id, status)`
  );
}

function tableHasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function ensureCardCreatedByColumn(db, tableName = "cards") {
  if (!tableHasColumn(db, tableName, "created_by")) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN created_by TEXT`);
  }
}

function collectCards(retro) {
  const cards = [];
  ["well", "improve", "continue"].forEach((column) => {
    (retro.columns[column] || []).forEach((card) => {
      cards.push({
        id: card.id,
        columnType: column,
        text: card.text,
        details: card.details || "",
        votes: Number.isFinite(card.votes) ? card.votes : 0,
        status: null,
        notes: null,
        createdBy: card.createdBy || card.created_by || ""
      });
    });
  });
  return cards;
}

function collectActions(retro) {
  return (retro.actions || []).map((action) => normalizeActionItem(action));
}

function runRetroUpsert(db, tableName, retro, timestamp) {
  const normalized = normalizeRetro(retro);
  const retroStmt = db.prepare(
    `INSERT INTO ${tableName} (
      id,
      title,
      team_id,
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
      team_id = excluded.team_id,
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
    normalized.teamId,
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
    status: null,
    notes: null,
    createdBy: card.createdBy || card.created_by || ""
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
      created_by,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      retro_id = excluded.retro_id,
      column_type = excluded.column_type,
      text = excluded.text,
      details = excluded.details,
      votes = excluded.votes,
      status = excluded.status,
      notes = excluded.notes,
      created_by = excluded.created_by,
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
    normalized.createdBy,
    timestamp
  );
}

function runActionUpsert(db, tableName, retroId, action, timestamp) {
  const normalized = normalizeActionItem(action);
  const actionStmt = db.prepare(
    `INSERT INTO ${tableName} (
      id,
      retro_id,
      source_card_id,
      text,
      details,
      owner,
      due_date,
      status,
      notes,
      created_at,
      created_by,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      retro_id = excluded.retro_id,
      source_card_id = excluded.source_card_id,
      text = excluded.text,
      details = excluded.details,
      owner = excluded.owner,
      due_date = excluded.due_date,
      status = excluded.status,
      notes = excluded.notes,
      created_at = excluded.created_at,
      created_by = excluded.created_by,
      updated_at = excluded.updated_at`
  );

  actionStmt.run(
    normalized.id,
    retroId,
    normalized.sourceCardId,
    normalized.text,
    normalized.details,
    normalized.owner,
    normalized.dueDate,
    normalized.status,
    normalized.notes,
    normalized.createdAt,
    normalized.createdBy,
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

function saveRetroAction(db, retro, action, callback) {
  try {
    const timestamp = new Date().toISOString();
    const tx = db.transaction(() => {
      const normalized = runRetroUpsert(db, "retros", retro, timestamp);
      runActionUpsert(db, "actions", normalized.id, action, timestamp);
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
    const tables = {
      retros: "retros",
      cards: "cards",
      actions: "actions",
      ...(options.tables || {})
    };
    const deleteExisting = options.deleteExisting !== false;
    const timestamp = new Date().toISOString();

    const deleteCardsStmt = deleteExisting
      ? db.prepare(`DELETE FROM ${tables.cards} WHERE retro_id = ?`)
      : null;
    const deleteActionsStmt = deleteExisting
      ? db.prepare(`DELETE FROM ${tables.actions} WHERE retro_id = ?`)
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
        created_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const actionStmt = db.prepare(
      `INSERT INTO ${tables.actions} (
        id,
        retro_id,
        source_card_id,
        text,
        details,
        owner,
        due_date,
        status,
        notes,
        created_at,
        created_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      retros.forEach((retro) => {
        const normalized = runRetroUpsert(db, tables.retros, retro, timestamp);
        if (deleteCardsStmt) {
          deleteCardsStmt.run(normalized.id);
        }
        if (deleteActionsStmt) {
          deleteActionsStmt.run(normalized.id);
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
            card.createdBy,
            timestamp
          );
        });
        collectActions(normalized).forEach((action) => {
          actionStmt.run(
            action.id,
            normalized.id,
            action.sourceCardId,
            action.text,
            action.details,
            action.owner,
            action.dueDate,
            action.status,
            action.notes,
            action.createdAt,
            action.createdBy,
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
    const tempTables = { retros: "retros_v2", cards: "cards_v2", actions: "actions_v2" };
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
          db.exec("ALTER TABLE actions_v2 RENAME TO actions");
          db.exec("CREATE INDEX IF NOT EXISTS idx_cards_retro ON cards(retro_id)");
          db.exec(
            "CREATE INDEX IF NOT EXISTS idx_cards_retro_column ON cards(retro_id, column_type)"
          );
          db.exec("CREATE INDEX IF NOT EXISTS idx_actions_retro ON actions(retro_id)");
          db.exec(
            "CREATE INDEX IF NOT EXISTS idx_actions_retro_status ON actions(retro_id, status)"
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

function dropLegacyBoardData(db) {
  db.exec("DROP TABLE IF EXISTS teams");
  db.exec("DROP TABLE IF EXISTS actions");
  db.exec("DROP TABLE IF EXISTS cards");
  db.exec("DROP TABLE IF EXISTS retros");
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
    if (version < 6) {
      const tx = db.transaction(() => {
        dropLegacyBoardData(db);
        createNormalizedSchema(db, { retros: "retros", cards: "cards" });
        ensureCardCreatedByColumn(db);
        db.exec(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '6')"
        );
      });
      tx();
    } else {
      createNormalizedSchema(db, { retros: "retros", cards: "cards" });
      ensureCardCreatedByColumn(db);
    }
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
    const actionRows = db.prepare("SELECT * FROM actions").all();
    const cardsByRetro = new Map();
    (cardRows || []).forEach((card) => {
      if (!cardsByRetro.has(card.retro_id)) {
        cardsByRetro.set(card.retro_id, []);
      }
      cardsByRetro.get(card.retro_id).push(card);
    });
    const actionsByRetro = new Map();
    (actionRows || []).forEach((action) => {
      if (!actionsByRetro.has(action.retro_id)) {
        actionsByRetro.set(action.retro_id, []);
      }
      actionsByRetro.get(action.retro_id).push(action);
    });

    const retros = retroRows.map((row) => {
      const columns = { well: [], improve: [], continue: [] };
      const cards = cardsByRetro.get(row.id) || [];
      cards.forEach((card) => {
        const columnType = card.column_type === "action" ? "continue" : card.column_type;
        if (!columns[columnType]) {
          return;
        }
        const mapped = {
          id: card.id,
          text: card.text,
          details: card.details || "",
          votes: Number.isFinite(card.votes) ? card.votes : 0,
          createdBy: card.created_by || ""
        };
        columns[columnType].push(mapped);
      });
      const actions = (actionsByRetro.get(row.id) || []).map((action) =>
        normalizeActionItem(action)
      );

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
        teamId: row.team_id,
        createdAt: row.created_at,
        closed: Boolean(row.closed),
        closedAt: row.closed_at,
        columns,
        actions,
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
        "DELETE FROM actions WHERE retro_id IN (SELECT id FROM retros WHERE closed = 1 AND closed_at IS NOT NULL AND closed_at < ?)"
      ).run(cutoff);
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

function createRetroRow(db, { id, title, teamId }) {
  const now = new Date().toISOString();
  return runRetroUpsert(
    db,
    "retros",
    normalizeRetro({
      id,
      title,
      teamId,
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

function getRetroById(db, id) {
  return db.prepare("SELECT * FROM retros WHERE id = ?").get(id) || null;
}

function getRetrosForTeamId(db, teamId) {
  return db
    .prepare("SELECT * FROM retros WHERE team_id = ? ORDER BY created_at DESC")
    .all(teamId);
}

module.exports = {
  defaultTimer,
  defaultColumns,
  normalizeActionItem,
  normalizeColumns,
  normalizeTimer,
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
};
