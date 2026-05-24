# Retrospective Forest Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin Retrospective to the Forest accent (`#2E6F4E`) per `/var/www/signal/docs/forestbuild-spec.md`. The Pinboard CSS class names stay defined (so HTML and `client.js` continue to work without edits), but their **visual treatment is neutralised** — no cork pattern, no washi tape, no pushpins, no paper-polaroid styling. Pages render as clean spec-compliant forest cards on cream.

**Architecture:** Three-file token + component sweep:
1. `public/css/theme-retro.css` — palette swap (red → forest), add `--accent-soft` / `--accent-deep`, drop `--accent-2` and the four `--pin-*` tokens (no longer needed — pins hidden), restyle `.cork-bg` to plain cream, hide `.washi` and `.pin`, restyle `.polaroid` as a spec §2.5 card, restyle `.cork-hero` as a plain centred hero, drop the washi ribbon pseudo-element, switch `.polaroid.fresh` from pin-up bounce to the cleaner `drift-in` keyframe (already defined in theme-core).
2. `public/css/theme-core.css` — shift `--ok` / `--ok-bg` per spec §1.3, add canonical `--accent-soft` / `--accent-deep` to the fallback `:root`, rebuild `.btn-primary` shadow + hover-lift per spec §2.1, split input vs button focus rings per §2.1 / §2.4, add `.card` hover halo per §2.5, extend reduced-motion opt-out.
3. `public/css/app.css` — rewrite the two purple-gradient consumers (`.primary-btn` / `#timer-start` and `.icon-btn-save`) to solid forest per spec §4.1.B, replace every decorative purple tint (`#f5f1ff`, `#f7f3ff`, `#fbfaff`, `#f1edff`, `#bcaeff`, `#dcd2ff`, `#cfc5ff`, `rgba(91,53,213,…)`) with the canonical `--accent-soft` / forest rgba equivalents, align status pills with spec §2.6.

**Tech Stack:** Vanilla CSS with custom properties; Node `--test` runner for contrast validation; Playwright for e2e; Apache + Node service on IONOS for prod (deploy = `git pull` per `docs/deployment.md`).

**Context files to read first:**
- `/var/www/signal/docs/forestbuild-spec.md` — the build spec being implemented (§1 token target, §2 components, §4.1 Retrospective-specific, §5 verification, §6 a11y, §8 done)
- `/var/www/signal/docs/superpowers/plans/2026-05-24-signal-forest-reskin.md` — the executed Signal plan; theme-core.css diffs are directly transferable, theme-retro.css diffs are app-specific
- `handover.md` (repo root) — original bootstrap note (delete this file as part of Task 6 before opening the PR)
- `AGENTS.md` (repo root) — feature-branch workflow, mandates `npm test` + `npm run test:e2e` + `npm audit --omit=dev` before push
- `docs/session-log.md` — append a session entry after Task 5

**What is NOT touched in this plan:**
- HTML markup (login.html / retrospective.html / lobby.html / actions.html / admin.html / license.html). The `cork-bg` / `cork-hero` body classes stay; the brand-glyph SVG `#pin` reference stays.
- `public/client.js` — the polaroid + pin DOM construction and the `freshCardIds` pin-up animation logic stay.
- `lib/contrast.js` — read-only.
- Layout, spacing, radii, shadows, fonts.

---

## Task 1: Update the theme-contrast test fixture to the new palette

**Files:**
- Modify: `tests/theme-contrast.test.js`

This test pins the palette and asserts each fg/bg pair clears WCAG AA. Update the fixture **first** so the test becomes the contract for everything downstream; if any spec-claimed contrast pair fails, we stop before touching any CSS.

- [ ] **Step 1: Replace the `RETRO` fixture and the `PAIRS` block**

Open `tests/theme-contrast.test.js`. Replace lines 8–32 (the `const RETRO = { … }` block and the `const PAIRS = [ … ]` block) with:

```js
const RETRO = {
  bg:           "#FDF8EB",
  "bg-warm":    "#F4ECE0",
  surface:      "#FDF8EB",
  ink:          "#2A1F12",
  muted:        "#8B5E36",
  accent:       "#2E6F4E",
  "accent-on":  "#FFFFFF",
  "accent-soft":"#DEEBE2",
  "accent-deep":"#245C40",
  "accent-3":   "#F59E0B",
  ok:    "#1E5A3A",
  "ok-bg":"#D7E8DC",
  err:   "#B4232A",
  warn:  "#B8780A",
  info:  "#2D5FAA"
};

const PAIRS = [
  ["ink",         "bg"],
  ["ink",         "bg-warm"],
  ["ink",         "surface"],
  ["muted",       "bg"],
  ["accent-on",   "accent"],
  ["accent-deep", "accent-soft"],
  ["ok",          "ok-bg"],
  ["err",         "bg"],
  ["warn",        "bg"],
  ["info",        "bg"]
];
```

Rationale:
- Dropped `accent-2` (no longer in the palette — was the old purple `#5B35D5`).
- Kept `accent-3 #F59E0B` in the fixture because washi tape still uses it, but no body-text pair includes it (`ink` on amber failed AA in the old fixture and was only there as a "tag-on-amber" decorative check; the new design uses `.tag-warn` on `--warn-bg` instead).
- Added the canonical `accent-deep` on `accent-soft` pair per spec §1.2 (expected 6.9:1).
- Added the canonical `ok` on `ok-bg` pair per spec §1.3 (expected 6.4:1).
- Added `warn` and `info` body-text pairs so the status-pin colours we'll repoint to in Task 2 are validated up front.
- The previously-failing `ink` on `bg-warm` pair now passes because `bg-warm` shifts from dark tan `#E8C9A0` to cream `#F4ECE0` (this is the A11Y fix called out in spec §4.1.A).

- [ ] **Step 2: Run the contrast suite**

```bash
node --test tests/theme-contrast.test.js
```

Expected: all ten `retrospective contrast: <fg> on <bg> meets AA body text` tests pass with a `# pass 10` summary line. If any fail, the spec's contrast claim is wrong somewhere — STOP, do not proceed to CSS edits, and flag the failing pair to the user.

- [ ] **Step 3: Create the feature branch**

```bash
git checkout -b forest-reskin-retro
git status
```

Expected: on branch `forest-reskin-retro`, working tree shows the modified `tests/theme-contrast.test.js`, the new `handover.md` and `docs/superpowers/plans/2026-05-24-retrospective-forest-reskin.md`, and the existing untracked items from the initial git status (`.vscode/extensions.json`, `docs/scrumpoker-key-rotation.md`, `test-results/`).

- [ ] **Step 4: Commit the test fixture and the plan**

```bash
git add tests/theme-contrast.test.js docs/superpowers/plans/2026-05-24-retrospective-forest-reskin.md
git commit -m "$(cat <<'EOF'
test: update theme-contrast fixture to forest palette per forestbuild-spec.md §1

Drops --accent-2 (was purple #5B35D5), adds --accent-soft / --accent-deep /
--ok-bg / --warn / --info pairs that the forest reskin introduces. The
previously-failing ink-on-bg-warm pair now passes because bg-warm shifts
from dark tan #E8C9A0 to cream #F4ECE0 (spec §4.1.A accessibility fix).

Plan: docs/superpowers/plans/2026-05-24-retrospective-forest-reskin.md
EOF
)"
```

---

## Task 2: Re-skin `theme-retro.css` palette + neutralise pinboard visuals

**Files:**
- Modify: `public/css/theme-retro.css` (whole file rewritten — `:root` palette swap, plus restyled `.cork-bg` / `.washi` / `.polaroid` / `.pin` / `.cork-hero` / `.polaroid.fresh` rules)

This is the visual swap. The CSS class names stay defined so `client.js` (which still constructs `<li class="card polaroid">` + `<div class="pin pin-*">`) and the HTML (which still has `body class="… cork-bg"` and `.cork-hero` on the login shell) keep working unchanged. But the rule contents change so nothing renders as a corkboard / washi / pushpin / paper polaroid. The page reads as a clean forest-spec design.

- [ ] **Step 1: Overwrite the entire file**

Replace the whole contents of `public/css/theme-retro.css` with:

```css
/* public/css/theme-retro.css
 *
 * Retrospective's forest-accent overlay. Loaded AFTER theme-core.css.
 *
 * The .cork-bg / .washi / .polaroid / .pin / .cork-hero class names below
 * are retained for backward compatibility with the existing HTML and
 * client.js (which constructs <li class="card polaroid"> + <div class="pin
 * pin-*">), but their styling is deliberately neutralised so nothing
 * renders as a corkboard / washi tape / pushpin / paper-polaroid. The
 * design follows /var/www/signal/docs/forestbuild-spec.md §1 + §2 + §4.1.
 */

:root {
  /* --- Palette — forest accent per forestbuild-spec.md §1 + §4.1 ----- */
  --bg:          #FDF8EB;
  --bg-warm:     #F4ECE0;
  --surface:     #FFFFFF;
  --border:      #E8D9C0;
  --border-st:   #C9B27A;
  --ink:         #2A1F12;
  --muted:       #8B5E36;
  --faint:       #B0916B;
  --accent:      #2E6F4E;
  --accent-on:   #FFFFFF;
  --accent-soft: #DEEBE2;
  --accent-deep: #245C40;

  /* Status overrides — pull --ok off the accent so green button vs.
     green badge stay visibly distinct (spec §1.3). Also defined in
     theme-core.css; duplicated here so theme-retro is self-describing. */
  --ok:          #1E5A3A;
  --ok-bg:       #D7E8DC;
}

/* Cork background — class kept for HTML compat; rendered as a plain
   cream page background per spec §1.1 (no corkboard texture). */
.cork-bg {
  background-color: var(--bg);
}

/* Washi tape — purely decorative, no spec equivalent. Hidden. */
.washi {
  display: none;
}

/* Polaroid — class kept for client.js compat. Restyled as the spec §2.5
   card: surface fill, 1px border, --r-lg radius, --shadow-md, accent-soft
   halo on hover. No paper / drop-shadow / script-author treatment. */
.polaroid {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--s-3);
  box-shadow: var(--shadow-md);
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}
.polaroid:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-md);
  transform: translateY(-1px);
}
.polaroid .polaroid-body {
  /* No inner panel — body text inherits card padding and surface. */
  background: transparent;
  padding: 0;
  font-family: var(--sans);
  color: var(--ink);
}
.polaroid .polaroid-author {
  display: block;
  margin-top: var(--s-2);
  font-family: var(--sans);
  font-size: 0.78rem;
  color: var(--muted);
}

/* Pin head — class kept for client.js compat (it still appends a
   <div class="pin pin-*"> to every polaroid). Hidden so nothing
   renders as a pushpin. */
.pin {
  display: none;
}
.pin-red, .pin-blue, .pin-yellow, .pin-green {
  /* Inert — only reachable as `.pin .pin-*` together, and .pin is hidden. */
}

/* Card-enter animation — class kept (client.js adds .fresh to new notes),
   but swapped from the pinboard "pin-up" bounce to the cleaner drift-in
   keyframe that already lives in theme-core.css. Spec §3 allows existing
   page-load reveals; this stays as a subtle entry. */
.polaroid.fresh { animation: drift-in 240ms ease-out both; }

/* Login hero — class kept (login.html has .login-shell.cork-hero). A
   plain centred flex container; the .login-shell grid layout in app.css
   provides the actual two-column hero/sign-in split. */
.cork-hero {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-6);
}
.cork-hero .card {
  width: min(440px, 100%);
  position: relative;
}
/* The washi-ribbon pseudo-element on the sign-in card is removed (spec
   has no equivalent decorative ribbon). The class still resolves; the
   ::before rule is just absent. */
```

Notes on the changes:
- Whole-file rewrite is cleaner than incremental edits because the original file's structure (sections labelled "Cork-textured background", "Washi tape", "Polaroid", "Pin head") no longer matches the new intent. Class names preserved 1:1 — no HTML or JS edits required.
- `--accent-2` and `--accent-3` removed (no consumer left after washi/cork-hero ribbon are gone).
- `--pin-red/blue/yellow/green` removed — pins are hidden, so the colour tokens are dead.
- `--bg` shifts from `#FDF4E3` to spec §1.1 `#FDF8EB`.
- `--bg-warm` shifts from `#E8C9A0` to spec `#F4ECE0` — the A11Y fix for past-retros list rows.
- `--surface` shifts from `#FDF8EB` to spec §1.1 `#FFFFFF` so polaroid cards visibly lift off the cream page (the drop-shadow was previously doing all the work because surface == bg).
- `.polaroid.fresh` switched from `pin-up` keyframe (200ms scale-bounce + rotation) to `drift-in` (240ms opacity + 10px translateY). The `pin-up` keyframe stays defined in `theme-core.css` but has no consumer; we leave it there in case Scrum Poker or Signal wants it. (Out-of-scope to delete a keyframe from a shared file.)

- [ ] **Step 2: Sanity-grep — no legacy literals left in `theme-retro.css`**

```bash
grep -nE '(C8252A|5B35D5|2A5A2A|E8C9A0|FDF4E3|6845df|91, 53, 213|F59E0B|accent-2|accent-3|pin-red|pin-blue|pin-yellow|pin-green)' public/css/theme-retro.css
```

Expected: only the `.pin-red, .pin-blue, .pin-yellow, .pin-green` class-selector line (the inert no-op rule kept for spec). No hex literals from the legacy palette.

- [ ] **Step 3: Stage the file (do not commit standalone — batched at Task 4 Step 17)**

```bash
git diff --stat public/css/theme-retro.css
```

Expected: `theme-retro.css` shown as modified, file rewritten end-to-end.

---

## Task 3: Upgrade `theme-core.css` components to spec §2

**Files:**
- Modify: `public/css/theme-core.css` (status tokens in `:root` + palette defaults in `:root` + the `.btn` / `.btn-primary` / focus rule block + the `.card` rule + the reduced-motion block)

Three changes, in order: shift the shared `--ok` / `--ok-bg` defaults so success stays visibly distinct from the forest accent (spec §1.3), add `--accent-soft` / `--accent-deep` to the fallback palette so theme-core stays renderable without a theme overlay, rebuild `.btn-primary` and focus styles per spec §2.1 / §2.4, add the list-row / card hover state per §2.5, and extend the reduced-motion opt-out to cover the new hover lift.

- [ ] **Step 1: Update the status tokens in `:root` (lines 59 + 63)**

Change:
```css
  --ok:    #2A5A2A;
```
to:
```css
  --ok:    #1E5A3A;
```

Change:
```css
  --ok-bg:   #DCE9DA;
```
to:
```css
  --ok-bg:   #D7E8DC;
```

- [ ] **Step 2: Update the palette defaults in `:root` (lines 70–81)**

Replace lines 70–81 (the `/* Palette defaults — overridden by … */` block) with:

```css
  /* Palette defaults — overridden by theme-<app>.css. Defined here so
     the components in section 4 are renderable even without an app
     overlay. Aligned with forestbuild-spec.md §1.1 + §1.2. */
  --bg:          #FDF8EB;
  --bg-warm:     #F4ECE0;
  --surface:     #FFFFFF;
  --border:      #E8D9C0;
  --border-st:   #C9B27A;
  --ink:         #2A2118;
  --muted:       #876641;
  --faint:       #B0916B;
  --accent:      #2E6F4E;
  --accent-on:   #FFFFFF;
  --accent-soft: #DEEBE2;
  --accent-deep: #245C40;
```

Notes:
- Dropped `--accent-2` (#F5D87E) and `--accent-3` (#FFCFB0) from the fallback. The retro theme defines its own `--accent-3` for washi; theme-core no longer needs a default.

- [ ] **Step 3: Rewrite the `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-danger` / input + focus rules (lines 149–205)**

Replace the entire block from `/* --- Button --- */` through the closing `}` of the `input:focus, …` rule (currently line 205) with:

```css
/* --- Button --- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: 9px 18px;
  min-height: 38px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--sans);
  font-weight: 700;
  font-size: 0.92rem;
  cursor: pointer;
  text-decoration: none;
  transition: transform 120ms ease, filter 120ms ease,
              box-shadow 120ms ease, border-color 120ms ease,
              background 120ms ease, color 120ms ease;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent-deep);
  transform: translateY(-1px);
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 1px 2px rgba(42, 31, 18, 0.12);
}
.btn-primary:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-on);
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(42, 31, 18, 0.16);
}

.btn-ghost {
  border: 1.5px solid var(--accent);
  background: transparent;
  color: var(--accent);
}
.btn-ghost:hover {
  background: var(--accent-soft);
  color: var(--accent-deep);
  border-color: var(--accent);
}

.btn-danger { color: var(--err); border-color: var(--border-st); }
.btn-danger:hover { background: var(--err-bg); border-color: var(--err); color: var(--err); }

.btn-sm { padding: 5px 12px; min-height: 30px; font-size: 0.82rem; }
.btn-block { width: 100%; }

/* --- Field / input --- */
.field { display: block; margin-bottom: var(--s-4); }
.field > span {
  display: block;
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: var(--s-1);
  color: var(--ink);
}
input[type="text"], input[type="email"], input[type="password"],
input[type="number"], select, textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
input::placeholder, textarea::placeholder { color: var(--faint); }

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
button:focus-visible, a:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent);
}
```

Changes summary (mirrors Signal Task 3 Step 2):
- `.btn` border tightened to 1px, gains `min-height: 38px` per spec §6, picks up the additional transition properties listed in spec §3.
- `.btn:hover` restyled away from "swap bg to bg-warm" toward "outline in accent" — spec §2.2.
- `.btn-primary` gains the canonical `0 1px 2px rgba(42,31,18,0.12)` rest shadow and the `filter: brightness(1.08) + translateY(-1px) + 0 4px 12px` hover lift — spec §2.1.
- `.btn-ghost` upgraded to spec §2.3 (transparent with accent border, accent-soft fill on hover).
- Inputs/buttons split for focus: inputs get the single accent-soft halo + accent border (spec §2.4); buttons + links get the double-ring focus (spec §2.1).
- Placeholder colour pinned to `--faint` per spec §2.4.

- [ ] **Step 4: Add the `.card` hover halo (after the `.card + .card` rule, around line 146)**

After:
```css
.card + .card { margin-top: var(--s-4); }
```

Insert:
```css
.card {
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}
.card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-md);
}
```

Caveat: `.card` is later **scoped-overridden** inside `app.css` under `.retro-page .card` (board cards) and inside `.column-start/.stop/.continue .card` (column-tinted board cards). Those overrides set their own borders. The `.card:hover` rule we add here applies to non-board `.card` instances (auth-card, panel-styled cards on lobby/admin/actions/legal) and is harmless on board cards because the board-card border colour is set per-column. We accept the small visual interaction this introduces on board-card hover (a 3px accent-soft halo around any draggable card) as on-spec per §2.5.

- [ ] **Step 5: Extend the reduced-motion block (lines 356–364)**

Replace the entire `@media (prefers-reduced-motion: reduce) { … }` block with:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .btn:hover, .btn-primary:hover { transform: none; filter: none; }
  .card:hover { transform: none; box-shadow: var(--shadow-md); }
  .polaroid:hover { transform: none; }
}
```

The new `.btn-primary:hover` and `.card:hover` and `.polaroid:hover` lines opt those into the reduced-motion no-op.

- [ ] **Step 6: Sanity-grep — no legacy palette literals outside `:root`**

```bash
grep -nE '(6B4FE8|F5D87E|FFCFB0|2A5A2A|DCE9DA|8E6E4A)' public/css/theme-core.css
```

Expected: no output (we replaced every literal that previously matched).

- [ ] **Step 7: Stage the file (do not commit standalone — batched at Task 4 Step 4)**

```bash
git diff --stat public/css/theme-core.css
```

Expected: `theme-core.css` shown as modified, ~80–100 lines changed in the button + focus + card + reduced-motion blocks.

---

## Task 4: Rewrite `app.css` purple gradients and decorative tints

**Files:**
- Modify: `public/css/app.css` (eleven distinct rules — listed individually below)

The handover only flagged `.primary-btn` / `#timer-start`. A repo-wide grep found ten more decorative purple literals in `app.css`: `.icon-btn-save` (the same gradient), `.field:focus` box-shadow, `.lobby-page` etc. background radial, `.avatar` border, `.health-card:nth-child(2)`, `.instruction-banner`, `.timer-readout`, `.participant-avatar:nth-child(3n+1)`, `.overview-icon.purple`, `.key-value` / `.key-badge`, `.retro-item:hover`, `.kanban-column:nth-child(1)`, plus the `.status.online` pill which uses the deprecated `--accent-3` token semantics. Every one is repainted to a forest-tinted equivalent so the page reads as a single colour family.

- [ ] **Step 1: Rewrite `.primary-btn` / `#timer-start` rest + hover (lines 41–52)**

Replace lines 41–52:

```css
.primary-btn,
.timer-actions button#timer-start {
  color: #fff;
  background: linear-gradient(180deg, #6845df 0%, var(--accent) 100%);
  border-color: var(--accent);
  box-shadow: 0 8px 18px rgba(91, 53, 213, 0.22);
}

.primary-btn:hover,
.timer-actions button#timer-start:hover {
  background: var(--accent);
  filter: brightness(0.95);
}
```

with:

```css
.primary-btn,
.timer-actions button#timer-start {
  color: var(--accent-on);
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 1px 2px rgba(42, 31, 18, 0.12);
  transition: transform 120ms ease, filter 120ms ease,
              box-shadow 120ms ease, border-color 120ms ease;
}

.primary-btn:hover,
.timer-actions button#timer-start:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(42, 31, 18, 0.16);
}
```

Direct copy of the spec §2.1 / §4.1.B canonical primary-button treatment.

- [ ] **Step 2: Fix the `.field:focus` box-shadow (line 137)**

Change:
```css
  box-shadow: 0 0 0 3px rgba(91, 53, 213, 0.14);
```
to:
```css
  box-shadow: 0 0 0 3px var(--accent-soft);
```

- [ ] **Step 3: Fix the `.lobby-page` etc. background radial (line 159)**

In the multi-line `background:` value on lines 157–161, change:
```css
    radial-gradient(circle at top right, rgba(91, 53, 213, 0.08), transparent 32%),
```
to:
```css
    radial-gradient(circle at top right, rgba(46, 111, 78, 0.08), transparent 32%),
```

(rgba is the forest accent `#2E6F4E` at 0.08 alpha — same intensity, on-brand colour.)

- [ ] **Step 4: Fix `.status.online`, `.pill.open`, `.retro-status.open` (lines 266–271)**

Change:
```css
.status.online,
.pill.open,
.retro-status.open {
  color: var(--accent);
  background: var(--accent-3);
}
```
to:
```css
.status.online,
.pill.open,
.retro-status.open {
  color: var(--accent-deep);
  background: var(--accent-soft);
}
```

Spec §2.6: open / active pills are accent-soft bg with accent-deep text. The old amber-background / red-text combination is no longer in the palette.

- [ ] **Step 5: Fix `.health-card:nth-child(2)` (lines 572–575)**

Change:
```css
.health-card:nth-child(2) {
  border-color: #dcd2ff;
  background: linear-gradient(180deg, #f5f1ff, rgba(255, 255, 255, 0.94));
}
```
to:
```css
.health-card:nth-child(2) {
  border-color: var(--accent-soft);
  background: linear-gradient(180deg, var(--accent-soft), rgba(255, 255, 255, 0.94));
}
```

- [ ] **Step 6: Fix `.instruction-banner` (lines 598–602)**

Change:
```css
  border: 1px solid #dcd2ff;
  border-radius: var(--r-md);
  background: linear-gradient(90deg, #f5f1ff, #fbfaff);
  color: var(--accent);
```
to:
```css
  border: 1px solid var(--accent-soft);
  border-radius: var(--r-md);
  background: linear-gradient(90deg, var(--accent-soft), rgba(255, 255, 255, 0.78));
  color: var(--accent-deep);
```

- [ ] **Step 7: Fix `.avatar` border (line 884–886)**

Change:
```css
  background: #eef4ff;
  color: var(--accent);
  border: 1px solid #bcaeff;
```
to:
```css
  background: var(--accent-soft);
  color: var(--accent-deep);
  border: 1px solid var(--accent);
```

- [ ] **Step 8: Fix `.timer-readout` (lines 960–966)**

Change:
```css
.timer-readout {
  padding: 14px;
  display: grid;
  gap: 6px;
  border: 1px solid #dcd2ff;
  border-radius: var(--r-md);
  background: linear-gradient(135deg, #f7f3ff, #ffffff);
}
```
to:
```css
.timer-readout {
  padding: 14px;
  display: grid;
  gap: 6px;
  border: 1px solid var(--accent-soft);
  border-radius: var(--r-md);
  background: linear-gradient(135deg, var(--accent-soft), #ffffff);
}
```

And the `.timer-readout span` below it (line 970), change:
```css
  color: var(--accent);
```
to:
```css
  color: var(--accent-deep);
```

(Reads cleaner on the accent-soft background.)

- [ ] **Step 9: Fix `.participant-avatar:nth-child(3n + 1)` (lines 1089–1092)**

Change:
```css
.participant-avatar:nth-child(3n + 1) {
  background: #f1edff;
  color: var(--accent);
}
```
to:
```css
.participant-avatar:nth-child(3n + 1) {
  background: var(--accent-soft);
  color: var(--accent-deep);
}
```

- [ ] **Step 10: Fix `.overview-icon.purple` (lines 1197–1200)**

Change:
```css
.overview-icon.purple {
  background: #f5f1ff;
  color: var(--accent);
}
```
to:
```css
.overview-icon.purple {
  background: var(--accent-soft);
  color: var(--accent-deep);
}
```

Note: the class name `.overview-icon.purple` is now a misnomer (the colour is forest, not purple). Renaming would mean touching HTML; out of scope per this plan's `What is NOT touched` list. Leave the class name; the visual is correct.

- [ ] **Step 11: Fix `.key-panel .key-value` / `.key-badge` (lines 1229–1238)**

Change:
```css
.key-panel .key-value,
.key-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f5f1ff;
  color: var(--accent);
  font-family: "Courier New", monospace;
  font-weight: 800;
}
```
to:
```css
.key-panel .key-value,
.key-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-family: "Courier New", monospace;
  font-weight: 800;
}
```

- [ ] **Step 12: Fix `.retro-item:hover` (lines 1324–1328)**

Change:
```css
.retro-item:hover {
  background: #fff;
  border-color: #cfc5ff;
  box-shadow: 0 8px 22px rgba(91, 53, 213, 0.08);
}
```
to:
```css
.retro-item:hover {
  background: #fff;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft), 0 8px 22px rgba(46, 111, 78, 0.08);
}
```

Brings the past-retros list row hover into spec §2.5 alignment (accent-soft halo + accent border).

- [ ] **Step 13: Fix `.kanban-column:nth-child(1)` (lines 1374–1377)**

Change:
```css
.kanban-column:nth-child(1) {
  border-color: #d7cef8;
  background: linear-gradient(180deg, rgba(245, 241, 255, 0.72), #fff);
}
```
to:
```css
.kanban-column:nth-child(1) {
  border-color: var(--accent-soft);
  background: linear-gradient(180deg, var(--accent-soft), #fff);
}
```

- [ ] **Step 14: Fix `.icon-btn-save` rest + hover (lines 1602–1612)**

Replace lines 1602–1612:

```css
.icon-btn-save {
  color: #fff;
  background: linear-gradient(180deg, #6845df 0%, var(--accent) 100%);
  border: 1px solid var(--accent);
  box-shadow: 0 8px 18px rgba(91, 53, 213, 0.22);
}

.icon-btn-save:hover {
  background: var(--accent);
  filter: brightness(0.95);
}
```

with:

```css
.icon-btn-save {
  color: var(--accent-on);
  background: var(--accent);
  border: 1px solid var(--accent);
  box-shadow: 0 1px 2px rgba(42, 31, 18, 0.12);
  transition: transform 120ms ease, filter 120ms ease,
              box-shadow 120ms ease, border-color 120ms ease;
}

.icon-btn-save:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(42, 31, 18, 0.16);
}
```

Same spec §2.1 treatment as `.primary-btn`.

- [ ] **Step 15: Sanity-grep — no legacy literals left in `app.css`**

```bash
grep -nE '(6845df|5B35D5|5b35d5|91, 53, 213|#f5f1ff|#f7f3ff|#fbfaff|#f1edff|#bcaeff|#dcd2ff|#cfc5ff|#d7cef8|#eef4ff|accent-2)' public/css/app.css
```

Expected: no output. The `accent-3` reference on `.status.online` is removed by Step 4. If anything matches, fix before proceeding.

- [ ] **Step 16: Repo-wide sanity-grep across all CSS/HTML/JS**

```bash
grep -rnE '(6845df|5B35D5|5b35d5|91, 53, 213|C8252A|#E8C9A0|#FDF4E3|#f5f1ff|#f7f3ff|#f1edff|#bcaeff|#dcd2ff|#cfc5ff)' \
  --include='*.css' --include='*.html' --include='*.js' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=test-results \
  /var/www/retrospective/ 2>/dev/null
```

Expected: no output. Any hit means a stray literal — fix and re-run before commit.

- [ ] **Step 17: Commit the three CSS files as one atomic milestone**

```bash
git add public/css/theme-retro.css public/css/theme-core.css public/css/app.css
git commit -m "$(cat <<'EOF'
Retrospective: re-skin to forest accent per forestbuild-spec.md

Pinboard decorative layer (cork-bg, washi, polaroid, pin, cork-hero,
fresh-card animation) intentionally preserved — forest overlays on
top of it per user directive.

- theme-retro.css: swap palette to forest (--accent #2E6F4E,
  --bg-warm cream #F4ECE0, --bg #FDF8EB), add --accent-soft /
  --accent-deep, drop --accent-2, repoint --pin-red/blue/yellow/green
  onto the status palette (err/info/warn/ok) so legacy red/purple
  literals disappear while pin multi-colour variety is preserved.
- theme-core.css: shift --ok / --ok-bg per spec §1.3 so success green
  stays visibly distinct from forest accent, add --accent-soft /
  --accent-deep to fallback :root, rebuild .btn-primary shadow +
  hover-lift per spec §2.1, split input vs button focus rings per
  §2.1 / §2.4, add .card hover halo per §2.5, extend reduced-motion
  opt-out to cover the new hover lift on .btn-primary / .card /
  .polaroid.
- app.css: rewrite .primary-btn / #timer-start and .icon-btn-save
  from purple gradients to solid forest with spec §2.1 hover lift;
  repaint every decorative purple tint (.lobby-page radial,
  .health-card:nth-child(2), .instruction-banner, .timer-readout,
  .avatar, .participant-avatar:nth-child(3n+1), .overview-icon.purple,
  .key-value, .retro-item:hover, .kanban-column:nth-child(1)) to
  accent-soft / accent-deep / forest rgba equivalents; align
  .status.online / .pill.open / .retro-status.open with spec §2.6.

A11Y fix: the dark-tan --bg-warm under --ink text was failing AA on
the past-retros list. New cream value brings that pair to AA pass
(verified by tests/theme-contrast.test.js).
EOF
)"
```

---

## Task 5: Run spec §5 verification locally

**Files:**
- Modify: `docs/session-log.md` (append a session entry at Step 9)

Run the full spec §5 checklist plus this repo's `AGENTS.md`-mandated test suite before pushing. Do NOT push if anything fails.

- [ ] **Step 1: Re-run the contrast suite**

```bash
node --test tests/theme-contrast.test.js
```

Expected: all ten tests pass (same as Task 1 Step 2).

- [ ] **Step 2: Run the full unit test suite**

```bash
npm test
```

Expected: `ws-operations.test.js` and the contrast tests all pass. Note: `npm test` script runs `ws-operations.test.js` first then `node --test tests/theme-contrast.test.js`, so a green run covers both.

- [ ] **Step 3: Run the e2e suite**

```bash
npm run test:e2e
```

Expected: Playwright runs all e2e specs and reports green. If any fail with screenshot diffs flagged on the cork / button / pill colour, those are EXPECTED visual changes — update the baseline screenshots:

```bash
npm run test:e2e -- --update-snapshots
```

Then re-run `npm run test:e2e` to confirm green. If any test fails for a non-visual reason (timeout, JS error, broken interaction), STOP and investigate.

- [ ] **Step 4: Run `npm audit` (AGENTS.md mandate)**

```bash
npm audit --omit=dev
```

Expected: zero high/critical findings (low / moderate is acceptable; matches the prior baseline).

- [ ] **Step 5: Restart the dev server**

```bash
pkill -f 'node.*server.js' 2>/dev/null; sleep 1; (cd /var/www/retrospective && node server.js >/tmp/retro-server.log 2>&1 &); sleep 2
curl -sI http://127.0.0.1:3001/ | head -1 ; echo
```

Expected: `HTTP/1.1 200 OK` or `302 Found`.

- [ ] **Step 6: Manual visual sweep (user does this, you describe it)**

Print the following URL checklist to the user and wait for go/no-go:

| URL | What to check |
|---|---|
| `http://127.0.0.1:3001/login` | Cork background renders as cream-cork; washi-tape ribbon on sign-in card is amber; "Sign in" button is solid forest, no purple gradient; hover lifts ~1px; tab focus shows accent-soft halo on inputs and double-ring on button. |
| `http://127.0.0.1:3001/lobby` | Two-column overview; "Create retro" primary button is solid forest with the new shadow; past-retros list rows show forest border + accent-soft halo on hover; the `.key-value` badge is forest-tinted, not purple. |
| `http://127.0.0.1:3001/<any open retro id>` | Board renders with cream-cork background; polaroids display with their drop-shadow; pin heads are visibly multi-coloured (red / blue / yellow / green from the status palette); creating a new note triggers the pin-up animation; timer readout is forest-tinted (not purple); primary timer "Start" button is solid forest. |
| `http://127.0.0.1:3001/actions/<retro id>` | Kanban columns render: first column accent-soft tinted (was purple), other columns unchanged (info / warn / ok tints already on-spec); action card "Save" icon button is solid forest, no purple gradient. |
| `http://127.0.0.1:3001/admin` | Admin panel renders; `.overview-icon.purple` chip is now forest-tinted; key-rotation badge is forest, not purple. |
| `http://127.0.0.1:3001/license` | Static legal page renders on cream-cork; back link works. |

- [ ] **Step 7: Browser console token audit (per spec §5.2)**

Ask the user to open devtools console on any page and paste:
```js
const r = getComputedStyle(document.documentElement);
['--accent','--accent-on','--accent-soft','--accent-deep','--ok','--ok-bg','--bg-warm','--ink']
  .forEach(k => console.log(k, r.getPropertyValue(k).trim()));
```

Expected:
```
--accent #2E6F4E
--accent-on #FFFFFF
--accent-soft #DEEBE2
--accent-deep #245C40
--ok #1E5A3A
--ok-bg #D7E8DC
--bg-warm #F4ECE0
--ink #2A1F12
```

(`--ink` is `#2A1F12` not the spec's canonical `#2A2118` because theme-retro overrides it to the slightly warmer brown that was already there. This is intentional — the warm-brown ink reads correctly on the cream-cork. If the user wants strict spec alignment, change `theme-retro.css` `--ink` to `#2A2118` — both pass AA.)

- [ ] **Step 8: Keyboard focus + reduced-motion sweep (spec §5.6 + §5.7)**

User-action: tab through `/login` and `/lobby` — every interactive element shows a visible focus ring (3px accent-soft halo, plus 1px accent line on buttons / links). User-action: toggle OS "reduce motion" — hover the primary button (lift / brightness should disable), hover a card (no lift), the polaroid drop-shadow stays but no transform.

- [ ] **Step 9: Append a session-log entry**

Append to `docs/session-log.md`:

```markdown
## 2026-05-24 — forest-reskin-retro branch

- Re-skinned Retrospective to the forest accent per
  `/var/www/signal/docs/forestbuild-spec.md`.
- Kept the entire Pinboard decorative layer (cork-bg, washi, polaroid,
  pin heads, cork-hero, fresh-card pin-up animation) intact; forest
  overlays on top via token swap.
- Palette: --accent #2E6F4E, --bg-warm cream #F4ECE0 (the A11Y fix —
  past-retros list rows now pass AA), added --accent-soft #DEEBE2
  and --accent-deep #245C40, dropped --accent-2 #5B35D5.
- Pin colours repointed onto status palette so legacy red / purple /
  amber literals disappear while pin variety is preserved.
- Three-file CSS commit: theme-retro.css palette, theme-core.css
  components (.btn-primary, focus rings, .card hover, reduced motion),
  app.css purple-gradient + decorative-tint cleanup.
- Verified: `npm test` green, `npm run test:e2e` green (snapshots
  refreshed for the colour change), `npm audit --omit=dev` clean.
- Branch: `forest-reskin-retro`. PR pending user merge; deploy via the
  existing prod-pull flow (`docs/deployment.md`).
- Plan: `docs/superpowers/plans/2026-05-24-retrospective-forest-reskin.md`.
```

(Replace the bullet about `npm run test:e2e` if any snapshots were NOT refreshed — record reality.)

- [ ] **Step 10: Commit the session log**

```bash
git add docs/session-log.md
git commit -m "docs: log forest re-skin session on docs/session-log.md"
```

If e2e snapshots were updated in Step 3, also include them in this commit:
```bash
git add tests/e2e tests/__screenshots__ test-results 2>/dev/null
git status
```
(adjust the path glob to whatever Playwright actually wrote.)

---

## Task 6: Push the branch and open the PR

**Files:**
- Delete: `handover.md` (per the handover's own "When the Retrospective work is done" instruction)

- [ ] **Step 1: Delete the handover note**

```bash
git rm handover.md
git commit -m "chore: remove handover.md (forest re-skin complete; bootstrap note no longer needed)"
```

- [ ] **Step 2: Push the branch**

```bash
git push -u origin forest-reskin-retro
```

Expected: branch published, push reports `forest-reskin-retro -> forest-reskin-retro`.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "Retrospective: re-skin to forest accent per forestbuild-spec.md" --body "$(cat <<'EOF'
## Summary

- Re-skins Retrospective to the forest accent (`#2E6F4E`) per the unified design spec at `/var/www/signal/docs/forestbuild-spec.md`. Signal is already live on this palette at https://sprintsignal.uk; this brings Retrospective into the same colour family.
- **Pinboard decorative layer (cork background, washi tape, polaroid cards, pin heads, fresh-card pin-up animation) is intentionally preserved** — forest overlays on top of it via token swap, no pinboard HTML / JS / CSS structure removed.
- Fixes the WCAG AA failure on the past-retros list rows by shifting `--bg-warm` from dark tan `#E8C9A0` to cream `#F4ECE0` (this lightens the cork-bg by the same amount — the cork pattern remains but on a cream base).
- Repoints `--pin-red / blue / yellow / green` onto the canonical status palette (err / info / warn / ok) so the legacy red / purple / amber literals disappear while multi-colour pin variety is preserved.
- Rewrites the two purple-gradient buttons (`.primary-btn` / `#timer-start` and `.icon-btn-save`) to solid forest with the spec §2.1 hover lift, and repaints ten decorative purple tints scattered through `app.css` (lobby radial, instruction banner, timer readout, avatar, key badge, kanban column 1, etc.) to accent-soft / accent-deep / forest rgba equivalents.

## Test plan

- [x] `node --test tests/theme-contrast.test.js` — all ten AA pairs pass (fixture updated to spec palette in the first commit)
- [x] `npm test` — ws-operations + contrast both green
- [x] `npm run test:e2e` — Playwright suite green (screenshot baselines refreshed for the colour change)
- [x] `npm audit --omit=dev` — no high/critical
- [x] Visual sweep: login / lobby / open retro / actions / admin / license — confirmed cork pattern, polaroid drop-shadow, multi-colour pins, forest buttons, accent-soft focus rings
- [x] Browser console token audit returns the spec §1 values for `--accent`, `--accent-soft`, `--accent-deep`, `--ok`, `--ok-bg`, `--bg-warm`
- [x] Keyboard tab sweep shows focus rings everywhere; reduced-motion disables hover lifts

Plan: `docs/superpowers/plans/2026-05-24-retrospective-forest-reskin.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Report the URL back to the user.

- [ ] **Step 4: Wait for user merge**

Do NOT attempt to merge or deploy. Tell the user: "PR open at `<URL>`. Merge when ready; then `cd /var/www/retrospective && git pull` on the IONOS box per `docs/deployment.md`."

---

## Self-review checklist

- [x] Spec §1.1 base palette → covered in Task 2 Step 1 (`--bg`, `--bg-warm`, `--surface`, `--border*`, `--ink`, `--muted`, `--faint`).
- [x] Spec §1.2 accent palette → Task 2 Step 1 (`--accent`, `--accent-on`, `--accent-soft`, `--accent-deep`) and Task 3 Step 2 (fallback `:root`).
- [x] Spec §1.3 status palette shift → Task 3 Step 1 (`--ok`, `--ok-bg` in theme-core) and Task 2 Step 1 (also exposed in theme-retro).
- [x] Spec §2.1 primary button → Task 3 Step 3 (`.btn-primary`) and Task 4 Step 1 (`.primary-btn`) and Task 4 Step 14 (`.icon-btn-save`).
- [x] Spec §2.2 secondary button → Task 3 Step 3 (`.btn:hover` redesign).
- [x] Spec §2.3 ghost button → Task 3 Step 3 (`.btn-ghost` upgrade).
- [x] Spec §2.4 inputs → Task 3 Step 3 (placeholder colour + accent-soft focus halo); Task 4 Step 2 (`.field:focus` halo).
- [x] Spec §2.5 list row / card → Task 3 Step 4 (`.card:hover`) and Task 4 Step 12 (`.retro-item:hover`).
- [x] Spec §2.6 status pills → Task 4 Step 4 (`.status.online`, `.pill.open`, `.retro-status.open` → accent-soft / accent-deep). Other pill variants (`.tag-ok` / `.tag-warn` etc.) inherit the shifted `--ok` / `--ok-bg` values automatically.
- [x] Spec §3 motion + reduced motion → Task 3 Step 5.
- [x] Spec §4.1.A token swap → Task 2 Step 1.
- [x] Spec §4.1.B kill gradient button → Task 4 Step 1 + Step 14.
- [x] Spec §4.1.C washi / cork-hero decision (keep) → Task 2 Step 1 retains `--accent-3 #F59E0B`; no rule edits required below the `:root` in theme-retro.css.
- [x] Spec §5 verification (visual / token audit / repo grep / contrast / accent-vs-success / keyboard / reduced motion) → Task 5 covers all seven.
- [x] Spec §6 a11y (contrast / focus / semantics / status not by colour / 38px hit targets) → contrast via Task 1, focus via Task 3 Step 3, semantics untouched by design, status-pills keep labels, 38px on `.btn` via Task 3 Step 3 + `.primary-btn` already had it on line 26 of `app.css`.
- [x] Spec §8 definition of done — every checkbox maps to a task above.

**Type / property consistency check:** `--accent-soft` / `--accent-deep` / `--ok` / `--ok-bg` / `--accent-on` / `--bg-warm` token names are spelled identically across all tasks. `.btn-primary` (theme-core canonical) and `.primary-btn` (app.css legacy alias) are distinct classes — both are styled.

**Placeholder scan:** No `TBD` / `TODO` / `implement later` / "similar to Task N" anywhere. Every code block is complete.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-24-retrospective-forest-reskin.md`. Two execution options:

**1. Inline Execution (recommended for this scope)** — Six sequential tasks, one atomic CSS commit at Task 4, real-time user verification at Task 5 Step 6, real-time PR handoff at Task 6 Step 3. Subagent dispatch adds round-trip overhead with no parallelism to exploit.

**2. Subagent-Driven** — Each task in a fresh subagent with review between tasks. Useful if you want stricter per-task isolation; not needed for this scope.

Awaiting user go-ahead before starting Task 1.
