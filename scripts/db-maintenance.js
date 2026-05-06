const path = require("path");
const {
  openDatabase,
  ensureSchema,
  applyRetention
} = require("../db");

const command = process.argv[2] || "migrate";
const dbFile = process.env.RETRO_DB_PATH || path.join(__dirname, "..", "retros.db");

function exitWithError(message, err) {
  if (message) {
    console.error(message);
  }
  if (err) {
    console.error(err.message || err);
  }
  process.exit(1);
}

const db = openDatabase(dbFile);

if (command === "migrate") {
  ensureSchema(db, (err) => {
    if (err) {
      exitWithError("Failed to run migrations.", err);
      return;
    }
    console.log("Database migrations complete.");
    process.exit(0);
  });
} else if (command === "retention") {
  const days = Number.parseInt(process.env.RETRO_RETENTION_DAYS || process.argv[3], 10);
  if (!Number.isFinite(days) || days <= 0) {
    exitWithError("Provide RETRO_RETENTION_DAYS or a positive day count.");
    return;
  }
  applyRetention(db, days, (err) => {
    if (err) {
      exitWithError("Failed to apply retention.", err);
      return;
    }
    console.log(`Retention applied for retros closed more than ${days} days ago.`);
    process.exit(0);
  });
} else if (command === "vacuum") {
  try {
    db.exec("VACUUM");
    console.log("Database vacuum complete.");
    process.exit(0);
  } catch (err) {
    exitWithError("Failed to vacuum database.", err);
  }
} else {
  exitWithError("Unknown command. Use: migrate, retention, or vacuum.");
}
