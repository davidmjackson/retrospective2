// lib/logger.js — structured logging (pino). CommonJS.
// Reads NODE_ENV / LOG_LEVEL from the environment directly so importing this
// module never depends on app config wiring.
const { pino } = require("pino");

// Defense-in-depth field redaction. Request/response headers are never logged
// (see middleware/requestLogger.js), so cookies/authorization never reach a
// record; these paths catch app-level logs carrying a token/password field.
const REDACT_PATHS = ["token", "*.token", "password", "*.password"];

// Query-string keys whose values safeUrl masks (e.g. magic-link tokens).
const SENSITIVE_QUERY = new Set(["token", "password"]);

// Mask sensitive query param values while preserving the path, every other
// param byte-for-byte, and any #fragment. Targeted replacement (not a
// URLSearchParams round-trip) so "[redacted]" stays readable.
function safeUrl(url) {
  if (typeof url !== "string") return url;
  const q = url.indexOf("?");
  if (q === -1) return url;
  const path = url.slice(0, q);
  const query = url.slice(q + 1);
  const masked = query.replace(/([^&=#?]+)=([^&#]*)/g, (match, key, _val) =>
    SENSITIVE_QUERY.has(decodeURIComponent(key).toLowerCase()) ? `${key}=[redacted]` : match
  );
  return `${path}?${masked}`;
}

function createLogger({ level, pretty = false, stream } = {}) {
  const opts = {
    level: level ?? process.env.LOG_LEVEL ?? "info",
    base: { service: "retro" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  // `stream` takes precedence over `pretty` (used by tests for log capture).
  if (stream) return pino(opts, stream);
  if (pretty) return pino({ ...opts, transport: { target: "pino-pretty" } });
  return pino(opts);
}

const logger = createLogger({ pretty: process.env.NODE_ENV === "development" });

module.exports = { logger, createLogger, safeUrl, REDACT_PATHS };
