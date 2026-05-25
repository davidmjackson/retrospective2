/* breathing-waves.js
   Animated header background. No dependencies. Respects prefers-reduced-motion.
   Spec: docs/breathing-waves-header-background.md
   Usage:
     <header class="header-band" data-breathing-waves data-wave-palette="signal">
       <canvas></canvas>             // optional; created if absent
       <div class="header-content"> ... </div>
     </header>
*/
(function () {
  'use strict';

  var PALETTES = {
    signal: [[47,107,67],[143,191,159],[36,82,53],[99,150,112],[60,120,80]],
    retro:  [[46,110,99],[140,196,184],[33,84,75],[92,150,138],[58,122,110]],
    poker:  [[44,104,112],[138,190,196],[31,80,86],[88,148,156],[55,118,126]]
  };

  var CFG = {
    lineCount: 5,
    timeStep: 0.02,
    xStep: 5,
    opacityFloor: 0.08,
    opacityRange: 0.37,
    offsetSpreadPx: 80,
    dprCap: 2
  };

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeLines(n, palette) {
    var lines = [];
    for (var i = 0; i < n; i++) {
      lines.push({
        amp:      12 + Math.random() * 16,
        freq:     0.006 + Math.random() * 0.012,
        speed:    (0.25 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
        drift:    (Math.random() - 0.5) * 0.4,
        driftAmp: 18 + Math.random() * 22,
        phase:    Math.random() * Math.PI * 2,
        offset:   n > 1 ? (i / (n - 1) - 0.5) : 0,
        opSpeed:  0.2 + Math.random() * 0.5,
        opPhase:  Math.random() * Math.PI * 2,
        thSpeed:  0.18 + Math.random() * 0.45,
        thPhase:  Math.random() * Math.PI * 2,
        thMin:    2,
        thMax:    7 + Math.random() * 3,
        col:      palette[i % palette.length]
      });
    }
    return lines;
  }

  function init(host) {
    var canvas = host.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      host.insertBefore(canvas, host.firstChild);
    }
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');

    var ctx = canvas.getContext('2d');
    var paletteName = host.getAttribute('data-wave-palette') || 'signal';
    var palette = PALETTES[paletteName] || PALETTES.signal;
    var lines = makeLines(CFG.lineCount, palette);
    var t = 0;
    var w = 0, h = 0;

    function resize() {
      var rect = host.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, CFG.dprCap);
      w = rect.width; h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (var k = 0; k < lines.length; k++) {
        var L = lines[k];
        var o = CFG.opacityFloor +
                (Math.sin(t * L.opSpeed + L.opPhase) * 0.5 + 0.5) * CFG.opacityRange;
        var th = L.thMin +
                 (Math.sin(t * L.thSpeed + L.thPhase) * 0.5 + 0.5) * (L.thMax - L.thMin);
        var baseY = h / 2 + L.offset * CFG.offsetSpreadPx +
                    Math.sin(t * L.drift + L.phase) * L.driftAmp;
        ctx.strokeStyle = 'rgba(' + L.col[0] + ',' + L.col[1] + ',' + L.col[2] + ',' + o + ')';
        ctx.lineWidth = th;
        ctx.beginPath();
        for (var x = 0; x <= w; x += CFG.xStep) {
          var y = baseY + Math.sin(x * L.freq + t * L.speed + L.phase) * L.amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    var rafId = null;
    function frame() {
      draw();
      t += CFG.timeStep;
      rafId = window.requestAnimationFrame(frame);
    }

    resize();
    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(host);
    } else {
      window.addEventListener('resize', resize);
    }

    if (reduceMotion) {
      draw();
    } else {
      frame();
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
        } else if (!rafId) {
          frame();
        }
      });
    }
  }

  function boot() {
    var hosts = document.querySelectorAll('[data-breathing-waves]');
    for (var i = 0; i < hosts.length; i++) init(hosts[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
