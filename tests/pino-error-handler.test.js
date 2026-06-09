// tests/pino-error-handler.unit.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Writable } = require("node:stream");
const { createLogger } = require("../lib/logger.js");
const { makeRequestLogger } = require("../middleware/requestLogger.js");
const { makeErrorHandler } = require("../middleware/errorHandler.js");

function capture() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  return {
    stream,
    text: () => chunks.join(""),
    records: () => chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  };
}
const tick = () => new Promise((r) => setImmediate(r));

function appWithBoom({ nodeEnv = "production" } = {}) {
  const cap = capture();
  const logger = createLogger({ level: "info", stream: cap.stream });
  const app = express();
  app.use(makeRequestLogger(logger));
  app.get("/boom", () => { throw new Error("kaboom-secret-detail"); });
  app.get("/api/boom", () => { throw new Error("kaboom-secret-detail"); });
  app.use(makeErrorHandler({ logger, nodeEnv }));
  return { app, cap };
}

test("API/JSON error returns a clean 500 with a reqId and no internal detail", async () => {
  const { app } = appWithBoom();
  const res = await request(app).get("/boom").set("Accept", "application/json");
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Internal Server Error");
  assert.ok(typeof res.body.reqId === "string" && res.body.reqId.length > 0);
  assert.ok(!JSON.stringify(res.body).includes("kaboom-secret-detail"));
});

test("logs a structured error carrying the same reqId", async () => {
  const { app, cap } = appWithBoom();
  const res = await request(app).get("/boom").set("Accept", "application/json");
  await tick();
  const errRec = cap.records().find((r) => r.msg === "unhandled error");
  assert.ok(errRec, "expected an 'unhandled error' log record");
  assert.equal(errRec.reqId, res.body.reqId);
});

test("HTML error renders an inline page in prod without the stack", async () => {
  const { app } = appWithBoom({ nodeEnv: "production" });
  const res = await request(app).get("/boom");
  assert.equal(res.status, 500);
  assert.match(res.headers["content-type"], /html/);
  assert.ok(res.text.includes("Something went wrong"));
  assert.ok(!res.text.includes("kaboom-secret-detail"));
  assert.ok(res.headers["x-request-id"]);
  assert.ok(res.text.includes(res.headers["x-request-id"]));
  assert.ok(res.text.includes("Reference:"));
});

test("dev mode exposes the error message (JSON)", async () => {
  const { app } = appWithBoom({ nodeEnv: "development" });
  const res = await request(app).get("/boom").set("Accept", "application/json");
  assert.ok(JSON.stringify(res.body).includes("kaboom-secret-detail"));
});

test("/api/* errors return JSON even when the client asks for HTML", async () => {
  const { app } = appWithBoom();
  const res = await request(app).get("/api/boom").set("Accept", "text/html");
  assert.equal(res.status, 500);
  assert.match(res.headers["content-type"], /json/);
  assert.ok(!res.text.includes("kaboom-secret-detail"));
});

test("dev mode HTML error exposes the stack", async () => {
  const { app } = appWithBoom({ nodeEnv: "development" });
  const res = await request(app).get("/boom");
  assert.equal(res.status, 500);
  assert.match(res.headers["content-type"], /html/);
  assert.ok(res.text.includes("kaboom-secret-detail"));
});

test("HTML error has a usable reference when no requestLogger is mounted", async () => {
  const sink = new Writable({ write(_c, _e, cb) { cb(); } });
  const app = express();
  app.get("/boom", () => { throw new Error("x"); });
  app.use(makeErrorHandler({ logger: createLogger({ stream: sink }), nodeEnv: "production" }));
  const res = await request(app).get("/boom");
  assert.ok(!res.text.includes("undefined"), 'Reference should not render as "undefined"');
});
