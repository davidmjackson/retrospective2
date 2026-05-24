// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

const RETRO = {
  bg:           "#FDF8EB",
  "bg-warm":    "#F4ECE0",
  surface:      "#FFFFFF",
  ink:          "#2A1F12",
  muted:        "#8B5E36",
  accent:       "#2E6F4E",
  "accent-on":  "#FFFFFF",
  "accent-soft":"#DEEBE2",
  "accent-deep":"#245C40",
  ok:        "#1E5A3A",
  "ok-bg":   "#D7E8DC",
  err:       "#B4232A"
};

const PAIRS = [
  ["ink",         "bg"],
  ["ink",         "bg-warm"],
  ["ink",         "surface"],
  ["muted",       "bg"],
  ["accent-on",   "accent"],
  ["accent-deep", "accent-soft"],
  ["ok",          "ok-bg"],
  ["err",         "bg"]
];

for (const [fg, bg] of PAIRS) {
  test(`retrospective contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(RETRO[fg], RETRO[bg]);
    assert.ok(
      meetsAA(RETRO[fg], RETRO[bg]),
      `${fg} (${RETRO[fg]}) on ${bg} (${RETRO[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`
    );
  });
}
