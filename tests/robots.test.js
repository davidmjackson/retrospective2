"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const request = require("supertest");

// Mirror the catch-all static mount from server.js:
//   app.use(express.static(path.join(__dirname, "public"), { index: false, extensions: [] }));
// so we verify /robots.txt is served from public/ exactly as in production.
function buildApp() {
  const app = express();
  app.use(
    express.static(path.join(__dirname, "..", "public"), {
      index: false,
      extensions: [],
    }),
  );
  return app;
}

test("GET /robots.txt returns 200", async () => {
  const res = await request(buildApp()).get("/robots.txt");
  assert.equal(res.status, 200);
});

test("GET /robots.txt allows all crawlers", async () => {
  const res = await request(buildApp()).get("/robots.txt");
  assert.match(res.text, /User-agent:\s*\*/);
  assert.match(res.text, /Allow:\s*\//);
});
