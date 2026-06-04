"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const shell of ["lobby.html", "actions.html", "retrospective.html"]) {
  test(`${shell} has hidden Return-to-Suite button + snippet`, () => {
    const html = fs.readFileSync(path.join(__dirname, "../public", shell), "utf8");
    assert.match(html, /data-suite-return/, "button marker present");
    assert.match(html, /\shidden(\s|>)/, "button ships hidden");
    assert.match(html, /\/auth-client\/suite-return\.js/, "snippet included");
  });
}

for (const shell of ["join.html", "license.html"]) {
  test(`${shell} (anon/public entry) does NOT have the Return-to-Suite button`, () => {
    const html = fs.readFileSync(path.join(__dirname, "../public", shell), "utf8");
    assert.doesNotMatch(html, /data-suite-return/, "anon entry must not show the button");
  });
}
