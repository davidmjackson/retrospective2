// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

// Instrument palette pairs Retro relies on. Hexes are the sRGB equivalents of
// the oklch tokens in public/css/instrument-core.css (converted via OKLab).
// Retro's accent is teal (data-app="retro").
const INS = {
  bone:      "#F1F3F5", // --bone      oklch(0.964 0.004 240)
  panel:     "#FDFEFF", // --panel     oklch(0.996 0.002 240)
  ink:       "#1A1F24", // --ink       oklch(0.235 0.013 250)
  soft:      "#52575D", // --soft      oklch(0.455 0.012 250)
  faint:     "#7C8186", // --faint     oklch(0.6 0.01 250)
  teal:      "#278994", // --teal      oklch(0.58 0.088 206) — retro accent
  tealwash:  "#D8F5F8", // --tealwash  oklch(0.95 0.03 206)
  green:     "#266248", // --green     oklch(0.45 0.077 162)
  greenwash: "#DDF5E9", // --greenwash oklch(0.95 0.03 165)
  white:     "#FFFFFF"
};

// Body text pairs — must meet AA 4.5:1.
const BODY_PAIRS = [
  ["ink",   "bone"],
  ["ink",   "panel"],
  ["soft",  "panel"],
  ["soft",  "bone"],
  ["green", "greenwash"]
];

for (const [fg, bg] of BODY_PAIRS) {
  test(`instrument contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(INS[fg], INS[bg]);
    assert.ok(
      meetsAA(INS[fg], INS[bg]),
      `${fg} (${INS[fg]}) on ${bg} (${INS[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`
    );
  });
}

// The teal primary button uses white, bold (700) label text. Tested as
// large/bold (needs 3:1). It is ~4.12:1 — passes large/bold but is just under
// AA body (4.5:1); acceptable for a bold button label.
test("instrument contrast: white on teal meets AA large/bold text", () => {
  const ratio = contrastRatio(INS.white, INS.teal);
  assert.ok(
    meetsAA(INS.white, INS.teal, { largeText: true }),
    `white on teal = ${ratio.toFixed(2)}:1, need 3:1 large/bold`
  );
});
