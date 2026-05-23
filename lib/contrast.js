"use strict";

/**
 * WCAG 2.1 contrast helpers. Used to check palette pairs at test-time so
 * the design system stays accessible as it evolves.
 */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

function relLuminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fgHex, bgHex) {
  const l1 = relLuminance(hexToRgb(fgHex));
  const l2 = relLuminance(hexToRgb(bgHex));
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

function meetsAA(fgHex, bgHex, { largeText = false } = {}) {
  const ratio = contrastRatio(fgHex, bgHex);
  return ratio >= (largeText ? 3 : 4.5);
}

module.exports = { contrastRatio, meetsAA };
