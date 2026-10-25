# Maizy mode and new welcome screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Maizy" theme that recolours the whole app from Maizy's art, and rebuild the welcome screen as layout A (Stage) in every theme.

**Architecture:** One new token block `.sg-app[data-theme="maizy"]` in `src/ui/ui.css` plus two new tokens (`--sg-sun`, `--sg-floor`) set in every theme. The welcome screen keeps its existing elements and refs (startBtn, startNote, cameraError, `#maizy`) but loses its card chrome; the sun and floor are CSS shapes behind Maizy.

**Tech Stack:** Electron + Vite, plain JS (`src/ui/index.js`), plain CSS (`src/ui/ui.css`). No test runner: tests are scripted checks run in the UI playground `src/ui/dev.html` (served from this worktree on its own Vite port, never the presenter's running app).

**Spec:** `docs/superpowers/specs/2026-10-25-maizy-mode-welcome-design.md`

## Global Constraints

- Only `src/ui/index.js` and `src/ui/ui.css` change. `#maizy` is never moved or re-created.
- No new dependencies or font files. Maizy theme font: `ui-rounded, "SF Pro Rounded", var(--sg-font)`.
- Palette anchors: paper #FBF2F4, ink #3A2630, muted #7A6470, plum #6B4A8C (white text), sun #F5D98E, floor #F4C7D0, lavender #B7A3DC.
- Text contrast ≥ 4.5:1 (fg, fg-muted on bg and surface-1; on-vital on vital) in every theme.
- Default theme stays "system". Top-bar button: dark → light, anything else → dark.
- Welcome copy: "Sit like Maizy." / "She copies how you sit. Slouch and she slouches. Sit tall and she cheers." / "Start camera" / "Video never leaves this laptop. Your computer may ask for permission to use the camera."
- Fits 900×640 without scrolling; stacks at the existing ≤720px rule. Reduced motion respected.

## Review Focus

- Saved theme "maizy" survives a reload (loadSettings accepts it) — Task 1 check.
- Camera blocked on the welcome: the error alert still appears and is readable — Task 2 check.
- Welcome at 900×640 in Dark: sun/floor don't wash out the text; no scrollbar — Task 2 check.
- Dashboard in Maizy mode: warn/danger issue rows still read as amber/red — Task 1 contrast check plus screenshot.
- Settings segmented control with four choices still fits the 380px sheet — Task 1 check.

---

### Task 1: Maizy theme

**Files:** Modify `src/ui/ui.css` (token blocks, html page background, segmented control columns), `src/ui/index.js` (ICON, THEMES, applyTheme, themeBtn handler).

**Interfaces:** Produces `data-theme="maizy"` on `.sg-app`, `data-sg-theme="maizy"` on `<html>`, tokens `--sg-sun`, `--sg-floor` defined in light, dark and maizy blocks.

- [ ] **Step 1: Write the failing check** (playground, after `localStorage` cleared):
  click `[data-theme-choice="maizy"]` → `app.dataset.theme === "maizy"`; `getComputedStyle(app).getPropertyValue("--sg-bg")` resolves to the paper colour; reload → still maizy; every `.sg-segment` fits (`scrollWidth <= clientWidth`); contrast(fg,bg), contrast(fg-muted,bg), contrast(fg-muted,surface-1), contrast(on-vital,vital) ≥ 4.5 for light, dark, maizy; top-bar button from maizy → dark.
- [ ] **Step 2: Run it, expect FAIL** (no maizy choice).
- [ ] **Step 3: Implement.** `ICON.heart` (24-grid stroke icon like the others); `THEMES` gains `{ id: "maizy", label: "Maizy", icon: ICON.heart }`; `.sg-segmented` uses `repeat(4, …)`; token block `.sg-app[data-theme="maizy"]` with `color-scheme: light`, all colour tokens, shadows tinted plum, `--sg-font` / `--sg-font-display` rounded; `html[data-sg-theme="maizy"]` background = paper; themeBtn icon/label treat maizy like light.
- [ ] **Step 4: Run the check, expect PASS.**
- [ ] **Step 5: Commit** "Add Maizy mode: a theme coloured from Maizy's art".

### Task 2: Welcome screen, layout A

**Files:** Modify `src/ui/index.js` (welcome markup in TEMPLATE), `src/ui/ui.css` (§1 Welcome, Maizy slot on welcome, ≤720 rule, short-window rule).

**Interfaces:** Consumes `--sg-sun`, `--sg-floor` (Task 1). Keeps refs `startBtn`, `startNote`, `cameraError`, `cameraErrorText`.

- [ ] **Step 1: Write the failing check** (each theme, 900×640 and 1280×800): `.sg-steps` and `.sg-privacy` absent; welcome title text "Sit like Maizy."; `.sg-welcome` and `.sg-maizy-card` have `box-shadow: none` and transparent background on the welcome; Maizy card is right of the text; `.sg-main` has no vertical overflow; with camera mode "fails: blocked", clicking Start camera shows `[data-ref="cameraError"]` visible inside the viewport.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Implement.** Welcome markup: h1 title, one `.sg-lede`, actions (startBtn), one `.sg-note` line (startNote, privacy + permission copy), error alert. CSS: on the welcome, cards lose background/shadow; sun = circle in `--sg-sun` behind Maizy (pseudo-element on the Maizy card); floor = band in `--sg-floor` across the bottom of `.sg-main`; Maizy stands on the floor; text column vertically centred, left aligned, max 30ch title.
- [ ] **Step 4: Run the check, expect PASS; screenshot every theme at both sizes and fix what looks off.**
- [ ] **Step 5: Commit** "Welcome screen: Maizy on stage, one line and one button".
