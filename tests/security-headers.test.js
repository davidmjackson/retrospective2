// tests/security-headers.test.js — verify HTTP security headers are present on responses.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { makeSecurityHeaders, DEFAULT_CSP } = require("../middleware/securityHeaders");

function buildApp() {
  const app = express();
  const csp = DEFAULT_CSP.replace("connect-src 'self'", "connect-src 'self' wss: ws:");
  app.use(makeSecurityHeaders({ contentSecurityPolicy: csp }));
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

test("security headers — X-Frame-Options is DENY", async () => {
  const res = await request(buildApp()).get("/test");
  assert.equal(res.headers["x-frame-options"], "DENY");
});

test("security headers — X-Content-Type-Options is nosniff", async () => {
  const res = await request(buildApp()).get("/test");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("security headers — Referrer-Policy is strict-origin-when-cross-origin", async () => {
  const res = await request(buildApp()).get("/test");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("security headers — Strict-Transport-Security includes max-age=31536000 and includeSubDomains", async () => {
  const res = await request(buildApp()).get("/test");
  const hsts = res.headers["strict-transport-security"] || "";
  assert.ok(hsts.includes("max-age=31536000"), `HSTS header should contain max-age=31536000, got: ${hsts}`);
  assert.ok(hsts.includes("includeSubDomains"), `HSTS header should contain includeSubDomains, got: ${hsts}`);
});

test("security headers — Permissions-Policy contains camera=()", async () => {
  const res = await request(buildApp()).get("/test");
  const pp = res.headers["permissions-policy"] || "";
  assert.ok(pp.includes("camera=()"), `Permissions-Policy should contain camera=(), got: ${pp}`);
});

test("security headers — CSP contains script-src 'self'", async () => {
  const res = await request(buildApp()).get("/test");
  const csp = res.headers["content-security-policy"] || "";
  assert.ok(csp.includes("script-src 'self'"), `CSP should contain script-src 'self', got: ${csp}`);
});

test("security headers — CSP script-src does NOT contain unsafe-inline", async () => {
  const res = await request(buildApp()).get("/test");
  const csp = res.headers["content-security-policy"] || "";
  // Extract just the script-src directive to check it specifically
  const scriptSrcMatch = csp.match(/script-src([^;]*)/);
  assert.ok(scriptSrcMatch, "CSP should have a script-src directive");
  assert.ok(
    !scriptSrcMatch[1].includes("unsafe-inline"),
    `script-src should not contain unsafe-inline, got: ${scriptSrcMatch[0]}`
  );
});

test("security headers — CSP connect-src includes wss:", async () => {
  const res = await request(buildApp()).get("/test");
  const csp = res.headers["content-security-policy"] || "";
  assert.ok(csp.includes("wss:"), `CSP connect-src should include wss:, got: ${csp}`);
});
