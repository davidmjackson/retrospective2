// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

const RETRO = {
  bg:        "#FDF4E3",
  "bg-warm": "#E8C9A0",
  surface:   "#FDF8EB",
  ink:       "#2A1F12",
  muted:     "#8B5E36",
  accent:    "#C8252A",
  "accent-on": "#FFFFFF",
  "accent-2": "#5B35D5",
  "accent-3": "#F59E0B",
  ok:   "#2A5A2A",
  err:  "#B4232A"
};

const PAIRS = [
  ["ink",   "bg"],
  ["ink",   "bg-warm"],
  ["ink",   "surface"],
  ["muted", "bg"],
  ["accent-on", "accent"],
  ["accent-on", "accent-2"],
  ["ink",   "accent-3"],
  ["ok",    "bg"],
  ["err",   "bg"]
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
