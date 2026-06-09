// middleware/errorHandler.js — central error handler. Mount LAST, after routes. CommonJS.
// Apps have no view engine, so the HTML branch returns a small self-contained page.
const { STATUS_CODES } = require("node:http");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function errorPage({ message, reqId }) {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Something went wrong</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">` +
    `<h1>Something went wrong</h1>` +
    `<p>${escapeHtml(message)}</p>` +
    `<p style="color:#666">Reference: ${escapeHtml(reqId)}</p>` +
    `<p><a href="/">Return home</a></p>` +
    `</body></html>`
  );
}

function makeErrorHandler({ logger, nodeEnv }) {
  const isProd = nodeEnv === "production";
  return function errorHandler(err, req, res, next) {
    const log = req.log || logger;
    const reqId = req.id ?? "n/a";
    if (res.headersSent) {
      log.warn({ err, reqId }, "error after headers sent");
      return next(err);
    }
    log.error({ err, reqId }, "unhandled error");

    const raw = err.status ?? err.statusCode;
    const status = Number.isInteger(raw) && raw >= 400 && raw < 600 ? raw : 500;
    res.status(status);

    const wantsJson =
      (typeof req.path === "string" && req.path.startsWith("/api")) ||
      (typeof req.accepts === "function" && req.accepts(["html", "json"]) === "json");

    if (wantsJson) {
      const body = { error: isProd ? STATUS_CODES[status] || "Error" : err.message || "Error", reqId };
      if (err.fields) body.fields = err.fields;
      return res.json(body);
    }
    const message = isProd ? "An unexpected error occurred." : err.stack || err.message || "Error";
    return res.type("html").send(errorPage({ message, reqId }));
  };
}

module.exports = { makeErrorHandler };
