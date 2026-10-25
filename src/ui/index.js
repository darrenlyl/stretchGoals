/**
 * stretchGoals UI screens (owner: Darren). Plain JS, no framework.
 *
 * ─── API ────────────────────────────────────────────────────────────────────
 *   ui.mount(el, services?)  Build every screen inside `el`. Call once. `el` should fill the window.
 *                            services = { posture, voice, stretches, camera }: each is that module's
 *                            exports (TEAM_GUIDE 3.4). All are optional; a missing one only makes its
 *                            buttons do less (stretches fall back to ./fallback-stretches.js).
 *   ui.update(state)         Pass the latest PostureState, ~10 times a second.
 *   ui.onPauseChange(cb)     cb(paused) runs when Pause/Resume is pressed in the UI. Returns an
 *                            unsubscribe function. THIS IS THE PAUSE SIGNAL: stop feeding frames while
 *                            paused, start again when it's false.
 *   ui.setPaused(bool)       For the tray's "pause"/"resume". Updates the UI and runs the callbacks.
 *   ui.isPaused()            true while paused.
 *   ui.showScreen(name)      "welcome" | "calibrate" | "dashboard" | "stretch". Tray "recalibrate" can
 *                            use showScreen("calibrate"). Going to "calibrate" stops a running stretch.
 *   ui.onCameraChange(cb)    cb(on) runs when the camera turns on or off (the top-bar Camera button
 *                            calls camera.stopCamera() / startCamera()). Returns an unsubscribe function.
 *
 * ─── Slots other tracks fill (made once in mount, never re-created) ─────────
 *   <video id="camera-video"> + <canvas id="camera-overlay">  Jordan: startCamera(video, canvas).
 *       Both are mirrored by ui.css (scaleX(-1)) and cropped the same way (object-fit: cover), so
 *       keep canvas.width/height = video.videoWidth/videoHeight and don't mirror them again.
 *   <div id="maizy">                                          Shawn: maizy.mount(el).
 *
 * ─── Wiring in src/app.js (Shawn) ───────────────────────────────────────────
 *   import * as camera from "./camera/index.js";
 *   import * as posture from "./posture/index.js";
 *   import * as voice from "./voice/index.js";
 *   import * as stretches from "./stretches/index.js";
 *   import { maizy } from "./maizy/index.js";
 *   import { ui } from "./ui/index.js";
 *
 *   ui.mount(document.querySelector("#app"), { camera, posture, voice, stretches });
 *   maizy.mount(document.querySelector("#maizy"));
 *   // The UI's Start button calls camera.startCamera(video, canvas) for you.
 *   let paused = false;
 *   ui.onPauseChange((p) => { paused = p; });
 *   camera.onPoseFrame((frame) => {
 *     if (paused) return;
 *     const state = posture.analyze(frame);
 *     ui.update(state); maizy.update(state); voice.voiceCoach.update(state);
 *     window.api.setTrayScore(state.score);
 *   });
 *   window.api.onTrayCommand((cmd) => {
 *     if (cmd === "pause") ui.setPaused(true);
 *     if (cmd === "resume") ui.setPaused(false);
 *     if (cmd === "recalibrate") ui.showScreen("calibrate");
 *   });
 */

import { ISSUES, ISSUE_IDS, emptyPostureState } from "../shared/contracts.js";
import { FALLBACK_STRETCHES, createFallbackStretches } from "./fallback-stretches.js";

// ─── Settings you might want to tweak ───────────────────────────────────────
const SCORE_GOOD = 80; // score >= 80 is green
const SCORE_OK = 50; //   score >= 50 is yellow, below that is red
const DEFAULT_SENSITIVITY = 0.5;
const CALIBRATION_MS = 3000;
const SCREENS = ["welcome", "calibrate", "dashboard", "stretch"];
const STORAGE_KEY = "stretchGoals.ui.settings";

// ─── Everything the UI remembers ────────────────────────────────────────────
let root = null; // the .sg-app element
let refs = {}; // named elements, found once by their data-ref attribute
let services = {}; // { posture, voice, stretches, camera }
let stretches = null; // Joseph's module, or the fallback
let screen = "welcome";
let lastState = emptyPostureState();
let paused = false;
const pauseListeners = new Set();
let cameraLive = false; // true while camera frames are playing in the <video>
let cameraStarting = false;
const cameraListeners = new Set();
let settings = { voiceOn: true, sensitivity: DEFAULT_SENSITIVITY, theme: "system" };
const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

// Calibration: idle → running → done | failed
let calib = { phase: "idle", message: "" };
let wasCalibrating = false;
let ownCalibration = false; // true while OUR Calibrate button's startCalibration() is running
let externalCalibration = false; // true while a calibration someone else started is running

// The stretch that's running right now, or null
let stretchRun = null;
// The step last drawn on the stretch screen: { run, index }
let shownStep = null;
// The stretch the dashboard is suggesting
let suggested = null;
// The stretch clicked in the picker (waits for its Start button), or null
let picked = null;

// One row per issue, made once and then shown/hidden (no rebuilding each frame)
const issueRows = {};
let issueOrder = "";

// ─── Small helpers ──────────────────────────────────────────────────────────

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/** Only touch the DOM when the text really changed. */
function setText(el, text) {
  const value = String(text ?? "");
  if (el.textContent !== value) el.textContent = value;
}

/** Show or hide an element (only touches the DOM when it changes). */
function show(el, visible) {
  if (el.hidden === visible) el.hidden = !visible;
}

/** Fill a progress ring. fraction: 0–1. */
function setRing(barEl, fraction) {
  const offset = (100 - clamp01(fraction) * 100).toFixed(1);
  if (barEl.dataset.offset !== offset) {
    barEl.dataset.offset = offset;
    barEl.style.strokeDashoffset = offset;
  }
}

/** The number inside a ring. data-len lets ui.css shrink 3+ characters ("100", "57%") to fit. */
function setRingValue(el, text) {
  setText(el, text);
  setData(el, "len", String(String(text ?? "").length));
}

/** Set a data-* attribute only when it changed (used for colours in ui.css). */
function setData(el, key, value) {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

/** "good" | "ok" | "bad" for a 0–100 score. */
function scoreTone(score) {
  if (score >= SCORE_GOOD) return "good";
  if (score >= SCORE_OK) return "ok";
  return "bad";
}

/** Call a service function without letting a teammate's bug crash the UI. */
function safeCall(fn, ...args) {
  try {
    return fn?.(...args);
  } catch (err) {
    console.error("[ui] service call failed:", err);
    return undefined;
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (typeof saved.voiceOn === "boolean") settings.voiceOn = saved.voiceOn;
    if (typeof saved.sensitivity === "number") settings.sensitivity = clamp01(saved.sensitivity);
    if (THEMES.some((t) => t.id === saved.theme)) settings.theme = saved.theme;
  } catch {
    // localStorage can be unavailable; the defaults are fine
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // not saved, but the setting still applies until the app closes
  }
}

// ─── Reading Joseph's stretch data defensively ──────────────────────────────

function allStretches() {
  const list = stretches?.STRETCHES;
  return Array.isArray(list) ? list : [];
}

function findStretch(id) {
  const found = allStretches().find((s) => s.id === id);
  if (found) return found;
  // With a health check, STRETCHES is already filtered: a missing one is ruled out, never swapped in
  return (services.safety ? null : FALLBACK_STRETCHES.find((s) => s.id === id)) ?? { id };
}

function stretchName(s) {
  if (s?.name || s?.title) return s.name ?? s.title;
  const id = String(s?.id ?? "Stretch").replace(/_/g, " ");
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function stepText(step) {
  if (typeof step === "string") return step;
  return step?.text ?? step?.say ?? step?.instruction ?? "";
}

function stretchHow(s) {
  return s?.how ?? s?.description ?? stepText(s?.steps?.[0]) ?? "";
}

function stretchSeconds(s) {
  if (!Array.isArray(s?.steps)) return s?.seconds ?? null;
  const total = s.steps.reduce((sum, step) => sum + (Number(step?.seconds) || 0), 0);
  return total || null;
}

/**
 * The first stretch that helps this issue, or a general one when there's no issue.
 * With a health check (services.safety) it only picks from the stretches that suit them, and
 * returns null when none do; it never falls back to the built-in list, which isn't filtered.
 */
function stretchFor(issueId) {
  if (issueId) {
    const list = safeCall(stretches?.stretchesFor, issueId);
    if (Array.isArray(list) && list.length) return list[0];
    if (services.safety) return null; // every stretch for this issue is ruled out: don't swap in an unrelated one
    const backup = FALLBACK_STRETCHES.find((s) => s.helps.includes(issueId));
    if (backup) return findStretch(backup.id);
  }
  if (!services.safety) return findStretch("shoulder_rolls");
  const all = allStretches();
  return all.find((s) => s.id === "shoulder_rolls") ?? all[0] ?? null;
}

// ─── Icons (outline, drawn on a 24px grid) ──────────────────────────────────

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon">${body}</svg>`;
const ICON = {
  mark: `<svg class="sg-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="9" height="5" rx="2.5"/><rect x="7" y="9.5" width="10" height="5" rx="2.5" opacity=".7"/><rect x="4.5" y="17" width="11" height="5" rx="2.5" opacity=".45"/></svg>`,
  sliders: svg(`<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`),
  pause: svg(`<path d="M9 6v12M15 6v12"/>`),
  play: svg(`<path d="M8 5.5v13l10-6.5z"/>`),
  close: svg(`<path d="M6 6l12 12M18 6L6 18"/>`),
  lock: svg(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`),
  check: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon sg-icon-lg"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  pulse: svg(`<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>`),
  stretch: svg(`<circle cx="12" cy="4.5" r="2"/><path d="M5 8.5l7 1.5 7-1.5M12 10v5l-3.5 6M12 15l3.5 6"/>`),
  gear: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>`),
  sun: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>`),
  moon: svg(`<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>`),
  heart: svg(`<path d="M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 6.9a4.2 4.2 0 0 1 7.5 2.6c0 5.4-7.5 10-7.5 10z"/>`),
  desktop: svg(`<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>`),
  camera: svg(`<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>`),
  cameraOff: svg(`<path d="M3 3l18 18M8.5 6.5h4.5a2.5 2.5 0 0 1 2.5 2.5v2l6-3.5v10l-2.2-1.3M15.5 17.5h-10.5A2.5 2.5 0 0 1 2.5 15V9a2.5 2.5 0 0 1 1.9-2.4"/>`),
};

// Theme: "system" follows the computer's light/dark setting. The top-bar button switches to
// dark from any other theme, and back to light from dark.
const THEMES = [
  { id: "system", label: "System", icon: ICON.desktop },
  { id: "light", label: "Light", icon: ICON.sun },
  { id: "dark", label: "Dark", icon: ICON.moon },
  { id: "maizy", label: "Maizy", icon: ICON.heart }, // warm colours from Maizy's art
];

// Title and one-line purpose shown in the top bar for each screen (welcome has its own hero)
const SCREEN_TEXT = {
  calibrate: ["Calibrate", "Sit tall for 3 seconds so we learn what good posture looks like for you."],
  dashboard: ["Your posture", "Live from your camera. Maizy mirrors how you sit."],
  stretch: ["Stretch break", "Move gently and stop if anything hurts."],
  stretchPick: ["Stretches", "Pick one. Each takes about half a minute, and the coach talks you through it."],
};

function ring(ref, valueRef) {
  return `
    <div class="sg-ring" data-ref="${ref}" data-tone="none">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="sg-ring-track" cx="60" cy="60" r="52" />
        <circle class="sg-ring-bar" data-ref="${ref}Bar" cx="60" cy="60" r="52" pathLength="100" />
      </svg>
      <div class="sg-ring-center"><span class="sg-ring-value" data-ref="${valueRef}">–</span></div>
    </div>`;
}

// ─── The screens, as HTML (built once in mount) ─────────────────────────────

const TEMPLATE = `
<div class="sg-app" data-screen="welcome" data-stretching="no">
  <!-- Left rail: navigation and the Maizy dock (hidden on the welcome screen) -->
  <nav class="sg-rail" data-ref="rail" aria-label="Main">
    <div class="sg-brand">${ICON.mark}<span class="sg-brand-name">stretch<span>Goals</span></span></div>
    <div class="sg-rail-nav">
      <button type="button" class="sg-nav" data-nav="dashboard" title="Dashboard">${ICON.pulse}<span class="sg-nav-label">Dashboard</span></button>
      <button type="button" class="sg-nav" data-nav="calibrate" title="Calibrate">${ICON.target}<span class="sg-nav-label">Calibrate</span></button>
      <button type="button" class="sg-nav" data-nav="stretch" title="Stretches">${ICON.stretch}<span class="sg-nav-label">Stretches</span><span class="sg-nav-live" data-ref="stretchLive" hidden>Live</span></button>
      <div class="sg-rail-sep" role="separator"></div>
      <button type="button" class="sg-nav" data-ref="settingsBtn" aria-haspopup="dialog" title="Settings">${ICON.gear}<span class="sg-nav-label">Settings</span></button>
    </div>
    <div class="sg-dock">
      <div class="sg-dock-row">
        <div class="sg-dock-maizy" id="maizy-mini"></div>
        <div class="sg-dock-text">
          <p class="sg-dock-score" data-ref="dockScore">–</p>
          <p class="sg-dock-word" data-ref="dockWord">Camera off</p>
        </div>
      </div>
      <button type="button" class="sg-btn sg-btn-primary sg-btn-sm" data-ref="dockStretch">Stretch now</button>
    </div>
  </nav>

  <div class="sg-body">
  <header class="sg-header">
    <div class="sg-brand sg-header-brand">${ICON.mark}<span class="sg-brand-name">stretch<span>Goals</span></span></div>
    <div class="sg-heading">
      <h1 class="sg-screen-title" data-ref="screenTitle"></h1>
      <p class="sg-screen-lede" data-ref="screenLede"></p>
    </div>
    <div class="sg-header-tools" data-ref="headerTools">
      <button type="button" class="sg-pill-status" data-ref="status" data-tone="good" title="Click to turn the camera off"><span class="sg-status-dot"></span><span data-ref="statusText">Watching</span></button>
      <!-- Camera on/off: a real switch. The track on the right shows the state. -->
      <button type="button" class="sg-btn sg-btn-tool" data-ref="cameraBtn" aria-pressed="false" title="Turn camera on">
        <span data-ref="cameraBtnIcon">${ICON.cameraOff}</span><span class="sg-tool-label">Camera</span><span class="sg-tool-switch" aria-hidden="true"></span>
      </button>
      <button type="button" class="sg-btn sg-btn-tool" data-ref="pauseBtn" title="Pause posture checks">
        <span data-ref="pauseIcon">${ICON.pause}</span><span class="sg-tool-label" data-ref="pauseLabel">Pause</span>
      </button>
      <button type="button" class="sg-btn sg-btn-icon" data-ref="themeBtn" aria-label="Switch theme" title="Switch theme"><span data-ref="themeIcon">${ICON.sun}</span></button>
    </div>
  </header>

  <main class="sg-main" data-ref="main">
    <div class="sg-grid">

      <!-- 1. Welcome / camera permission -->
      <section class="sg-card sg-welcome" aria-labelledby="sg-welcome-title">
        <h1 id="sg-welcome-title" class="sg-title">Meet Maizy. She slouches when you do.</h1>
        <p class="sg-lede">stretchGoals watches your posture through your camera, tells you what's off in plain words, and coaches you back with a quick stretch.</p>
        <div class="sg-welcome-body">
          <div>
            <h2 class="sg-h3">How it works</h2>
            <ol class="sg-steps">
              <li>Turn on your camera.</li>
              <li>Sit up tall for 3 seconds. That becomes your good posture.</li>
              <li>Get back to work. We only speak up when a problem lasts.</li>
            </ol>
          </div>
          <div class="sg-privacy">
            <h2 class="sg-h3">${ICON.lock} Your video stays on this laptop</h2>
            <p>Posture checks run right here. Video is never recorded or uploaded. Only the text of the coach's voice lines goes online.</p>
          </div>
        </div>
        <div class="sg-actions">
          <button type="button" class="sg-btn sg-btn-primary" data-ref="startBtn">Start camera</button>
          <span class="sg-note" data-ref="startNote">Your computer may ask for permission to use the camera.</span>
        </div>
        <div class="sg-alert" role="alert" data-ref="cameraError" hidden>
          <strong>We couldn't turn on your camera.</strong>
          <span data-ref="cameraErrorText"></span>
        </div>
      </section>

      <!-- Camera slot (Jordan). Never re-created. -->
      <figure class="sg-card sg-camera" aria-label="Your camera">
        <div class="sg-camera-off" data-ref="cameraOff">
          <span data-ref="cameraOffText">Camera is off</span>
          <button type="button" class="sg-btn sg-btn-secondary sg-btn-sm" data-ref="cameraOffBtn" hidden>Turn camera on</button>
        </div>
        <video id="camera-video" autoplay muted playsinline></video>
        <canvas id="camera-overlay"></canvas>
        <figcaption class="sg-chip" data-ref="cameraChip" hidden></figcaption>
      </figure>

      <!-- Maizy slot (Shawn). Never re-created. -->
      <div class="sg-card sg-maizy-card"><div id="maizy"></div></div>

      <!-- 2. Calibration -->
      <div class="sg-screen" data-for="calibrate">
        <section class="sg-card sg-side" aria-label="Calibration progress">
          <p class="sg-label">Calibration</p>
          ${ring("calibRing", "calibValue")}
          <p class="sg-verdict" data-ref="calibVerdict">Ready when you are</p>
        </section>
        <section class="sg-card sg-panel sg-calib" aria-labelledby="sg-calib-title">
          <div class="sg-calib-text">
            <h2 id="sg-calib-title" class="sg-h2">Sit up tall for 3 seconds</h2>
            <ul class="sg-tips">
              <li>Feet flat, back against your chair.</li>
              <li>Shoulders relaxed and level, chin level.</li>
              <li>Face the screen so your head and both shoulders are in view.</li>
            </ul>
          </div>
          <div class="sg-calib-action">
            <p class="sg-calib-message" data-ref="calibMessage" aria-live="polite">We'll remember this as your good posture.</p>
            <div class="sg-actions">
              <button type="button" class="sg-btn sg-btn-primary" data-ref="calibBtn">Start calibration</button>
              <button type="button" class="sg-btn sg-btn-text" data-ref="skipBtn">Skip for now</button>
            </div>
          </div>
        </section>
      </div>

      <!-- 3. Live dashboard -->
      <div class="sg-screen" data-for="dashboard">
        <section class="sg-card sg-side" aria-label="Posture score">
          <p class="sg-label">Posture score</p>
          ${ring("scoreRing", "scoreValue")}
          <p class="sg-verdict" data-ref="verdict">Not calibrated yet</p>
          <p class="sg-subverdict" data-ref="subVerdict"></p>
        </section>
        <section class="sg-card sg-issues" aria-labelledby="sg-issues-title">
          <div class="sg-card-head">
            <h2 id="sg-issues-title" class="sg-h3">What we're watching</h2>
            <span class="sg-count" data-ref="issueCount"></span>
          </div>
          <div class="sg-empty" data-ref="issuesEmpty">
            <p data-ref="issuesEmptyText"></p>
            <button type="button" class="sg-btn sg-btn-secondary" data-ref="issuesAction" hidden></button>
          </div>
          <ul class="sg-issue-list" data-ref="issueList"></ul>
        </section>
        <section class="sg-card sg-tip" aria-labelledby="sg-tip-title">
          <p class="sg-label" data-ref="tipLabel">Suggested stretch</p>
          <h2 id="sg-tip-title" class="sg-h3" data-ref="tipName"></h2>
          <p class="sg-tip-for" data-ref="tipFor"></p>
          <p class="sg-tip-how" data-ref="tipHow"></p>
          <div class="sg-tip-foot">
            <button type="button" class="sg-btn sg-btn-primary" data-ref="tipStart">${ICON.play}<span data-ref="tipStartLabel">Start stretch</span></button>
            <span class="sg-note" data-ref="tipTime"></span>
          </div>
        </section>
      </div>

      <!-- 4. Stretches. No stretch running: pick one (sg-stretch-pick). Running: the guide (sg-stretch-live). -->
      <div class="sg-screen" data-for="stretch">
        <section class="sg-card sg-pick-side sg-stretch-pick" aria-labelledby="sg-pick-title">
          <p class="sg-label" data-ref="pickLabel">Suggested for you</p>
          <h2 id="sg-pick-title" class="sg-h2" data-ref="pickName"></h2>
          <p class="sg-tip-for" data-ref="pickFor"></p>
          <p class="sg-tip-how" data-ref="pickHow"></p>
          <div class="sg-tip-foot">
            <button type="button" class="sg-btn sg-btn-primary" data-ref="pickStart">${ICON.play}Start stretch</button>
            <span class="sg-note" data-ref="pickTime"></span>
          </div>
        </section>
        <section class="sg-card sg-panel sg-picker sg-stretch-pick" aria-labelledby="sg-picker-title">
          <div class="sg-card-head">
            <h2 id="sg-picker-title" class="sg-h3">All stretches</h2>
            <span class="sg-count">Choose one, then press Start stretch</span>
          </div>
          <ul class="sg-pick-list" data-ref="pickList"></ul>
        </section>

        <section class="sg-card sg-side sg-stretch-live" aria-label="Time left in this step">
          <p class="sg-label">This step</p>
          ${ring("stretchRing", "stretchValue")}
          <p class="sg-verdict" data-ref="stretchStepOf"></p>
        </section>
        <section class="sg-card sg-panel sg-guide sg-stretch-live" aria-labelledby="sg-guide-title">
          <div class="sg-guide-text">
            <h2 id="sg-guide-title" class="sg-h2" data-ref="stretchName"></h2>
            <p class="sg-step-text" data-ref="stretchStep" aria-live="polite"></p>
            <p class="sg-next" data-ref="stretchNext"></p>
          </div>
          <div class="sg-guide-action">
            <p class="sg-safety">Move gently and stop if anything hurts. This isn't medical advice.</p>
            <button type="button" class="sg-btn sg-btn-secondary" data-ref="stopBtn">Stop stretch</button>
          </div>
        </section>
      </div>
    </div>
  </main>

  <footer class="sg-footer">
    <span><strong>Not medical advice.</strong> stretchGoals helps you notice your posture. It doesn't diagnose anything.</span>
    <span class="sg-footer-private">${ICON.lock} Video stays on this laptop</span>
  </footer>
  </div>

  <!-- 5. Settings (a panel that slides over the screen) -->
  <div class="sg-scrim" data-ref="scrim" hidden></div>
  <aside class="sg-settings" data-ref="settings" role="dialog" aria-modal="true" aria-labelledby="sg-settings-title" hidden>
    <div class="sg-settings-head">
      <h2 id="sg-settings-title" class="sg-h2">Settings</h2>
      <button type="button" class="sg-btn sg-btn-icon" data-ref="settingsClose" aria-label="Close settings">${ICON.close}</button>
    </div>

    <div class="sg-setting">
      <div class="sg-setting-row">
        <span class="sg-setting-title" id="sg-theme-label">Appearance</span>
      </div>
      <div class="sg-segmented" role="radiogroup" aria-labelledby="sg-theme-label" data-ref="themeChoices">
        ${THEMES.map((t) => `<button type="button" role="radio" class="sg-segment" data-theme-choice="${t.id}" aria-label="${t.label} theme">${t.icon}<span>${t.label}</span></button>`).join("")}
      </div>
      <p class="sg-setting-desc">System follows your computer's light or dark setting.</p>
    </div>

    <div class="sg-setting">
      <div class="sg-setting-row">
        <label class="sg-setting-title" for="sg-voice">Voice coach</label>
        <input type="checkbox" role="switch" id="sg-voice" class="sg-switch" data-ref="voiceToggle" />
      </div>
      <p class="sg-setting-desc">Speaks up when a problem lasts, and talks you through stretches.</p>
    </div>

    <div class="sg-setting">
      <div class="sg-setting-row">
        <label class="sg-setting-title" for="sg-sensitivity">Sensitivity</label>
        <span class="sg-setting-value" data-ref="sensitivityValue"></span>
      </div>
      <input type="range" id="sg-sensitivity" class="sg-range" min="0" max="1" step="0.05" data-ref="sensitivity" />
      <div class="sg-range-ends"><span>Relaxed</span><span>Strict</span></div>
      <p class="sg-setting-desc">How far you can drift from your calibrated posture before we flag it.</p>
    </div>

    <div class="sg-setting">
      <div class="sg-setting-row">
        <span class="sg-setting-title">Watching</span>
        <button type="button" class="sg-btn sg-btn-secondary" data-ref="settingsPause">Pause</button>
      </div>
      <p class="sg-setting-desc" data-ref="settingsPauseDesc">Stops posture checks until you resume.</p>
    </div>

    <div class="sg-setting">
      <div class="sg-setting-row">
        <span class="sg-setting-title">Calibration</span>
        <button type="button" class="sg-btn sg-btn-secondary" data-ref="recalibrateBtn">Recalibrate</button>
      </div>
      <p class="sg-setting-desc">Sit up tall again to reset what “good posture” means for you.</p>
    </div>

    <div class="sg-setting sg-health" data-ref="healthSetting" hidden>
      <div class="sg-setting-row">
        <span class="sg-setting-title" id="sg-health-title">Health check</span>
        <span class="sg-setting-value" data-ref="healthStatus"></span>
      </div>
      <p class="sg-setting-desc">Tick anything that applies, so we only suggest stretches that suit you. It's optional. Only an anonymous ID and what you tick are sent to IndyKite, which decides; never your name, email or video.</p>
      <ul class="sg-health-list" data-ref="healthList" aria-labelledby="sg-health-title"></ul>
      <p class="sg-setting-desc" data-ref="healthSource"></p>
    </div>
  </aside>
</div>`;

// ─── Screens ────────────────────────────────────────────────────────────────

function showScreen(name) {
  if (!root || !SCREENS.includes(name)) return;
  screen = name;
  setData(root, "screen", name);
  // You can't hold still for calibration in the middle of a stretch, so end it
  if (name === "calibrate") stopRunningStretch();
  if (name === "calibrate" && calib.phase !== "running" && !lastState.calibrating) {
    calib = { phase: "idle", message: "" };
  }
  render();
}

/** Redraw the parts that depend on state, using the newest state we have. */
function render() {
  renderHeader();
  renderCamera(lastState);
  if (screen === "calibrate") renderCalibration(lastState);
  if (screen === "dashboard") renderDashboard(lastState);
  if (screen === "stretch") renderStretch();
}

function renderHeader() {
  const onWelcome = screen === "welcome";
  show(refs.headerTools, !onWelcome);

  // Screen title and purpose. The stretch screen has two: picking one, or doing one.
  const key = screen === "stretch" && !stretchRun ? "stretchPick" : screen;
  const [title, lede] = SCREEN_TEXT[key] ?? ["", ""];
  setText(refs.screenTitle, title);
  setText(refs.screenLede, lede);
  setData(root, "stretching", stretchRun ? "yes" : "no");

  // Rail: highlight the current screen; "Live" on Stretches while one runs somewhere else
  for (const button of refs.navButtons) {
    const current = button.dataset.nav === screen;
    if (current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  show(refs.stretchLive, stretchRun !== null && screen !== "stretch");

  renderCameraButton();
  renderDock(lastState);

  let text = "Watching";
  let tone = "good";
  if (paused) [text, tone] = ["Paused", "off"];
  else if (dashboardMode(lastState) === "cameraOff") [text, tone] = ["Not watching", "off"];
  else if (screen === "calibrate" && (calib.phase === "running" || lastState.calibrating)) text = "Calibrating";
  else if (screen === "stretch" && stretchRun) text = "Stretching";
  setText(refs.statusText, text);
  setData(refs.status, "tone", tone);
  refs.status.title = cameraLive ? "Click to turn the camera off" : "Click to turn the camera on";
  refs.status.disabled = cameraStarting || !services.camera?.startCamera;
  // Pause button: icon + label
  const label = paused ? "Resume" : "Pause";
  if (refs.pauseLabel.textContent !== label) {
    refs.pauseLabel.textContent = label;
    refs.pauseIcon.innerHTML = paused ? ICON.play : ICON.pause;
    refs.pauseBtn.title = paused ? "Start posture checks again" : "Pause posture checks";
    refs.settingsPause.textContent = label;
    refs.settingsPauseDesc.textContent = paused
      ? "Paused. Posture checks are off until you resume."
      : "Stops posture checks until you resume.";
  }
}

/** The top-bar Camera switch: on (mint track), off, or starting. */
function renderCameraButton() {
  const state = cameraStarting ? "starting" : cameraLive ? "on" : "off";
  if (refs.cameraBtn.dataset.state === state) return;
  refs.cameraBtn.dataset.state = state;
  refs.cameraBtn.setAttribute("aria-pressed", String(cameraLive));
  refs.cameraBtn.disabled = cameraStarting || !services.camera?.startCamera;
  refs.cameraBtn.title = cameraStarting ? "Turning the camera on…" : cameraLive ? "Turn camera off" : "Turn camera on";
  refs.cameraBtnIcon.innerHTML = cameraLive ? ICON.camera : ICON.cameraOff;
  // The big "Camera is off" area gets its own button too
  show(refs.cameraOffBtn, Boolean(services.camera?.startCamera));
  refs.cameraOffBtn.disabled = cameraStarting;
  setText(refs.cameraOffBtn, cameraStarting ? "Turning on…" : "Turn camera on");
}

/** The Maizy dock at the bottom of the rail: live score and one word about it. */
function renderDock(state) {
  const mode = dashboardMode(state);
  const live = mode === "live";
  const score = live ? Math.round(state.score) : null;
  setText(refs.dockScore, score ?? "–");
  setData(refs.dockScore, "tone", live ? scoreTone(score) : "none");
  const words = { cameraOff: "Camera off", paused: "Paused", absent: "We can't see you", uncalibrated: "Not calibrated", unreadable: "Can't read you" };
  setText(refs.dockWord, live ? (score >= SCORE_GOOD ? "Sitting well" : score >= SCORE_OK ? "A little off" : "Slouching") : words[mode]);
  // While a stretch runs, the dock button takes you back to it
  const watchingIt = stretchRun !== null && screen === "stretch";
  refs.dockStretch.disabled = watchingIt;
  setText(refs.dockStretch, watchingIt ? "Stretching…" : stretchRun ? "Back to stretch" : "Stretch now");
}

// ─── Theme ──────────────────────────────────────────────────────────────────

/** Resolve "system" to light or dark and paint it. The page behind the app follows too. */
function applyTheme() {
  const resolved = settings.theme === "system" ? (darkQuery?.matches ? "dark" : "light") : settings.theme;
  setData(root, "theme", resolved);
  document.documentElement.dataset.sgTheme = resolved;
  for (const button of refs.themeChoices.querySelectorAll("[data-theme-choice]")) {
    button.setAttribute("aria-checked", String(button.dataset.themeChoice === settings.theme));
  }
  // The top-bar button shows what a click switches to
  refs.themeIcon.innerHTML = resolved === "dark" ? ICON.sun : ICON.moon;
  refs.themeBtn.setAttribute("aria-label", resolved === "dark" ? "Switch to light theme" : "Switch to dark theme");
  refs.themeBtn.title = refs.themeBtn.getAttribute("aria-label");
}

function setTheme(theme) {
  settings.theme = theme;
  saveSettings();
  applyTheme();
}

function renderCamera(state) {
  let chip = "";
  if (paused) chip = "Paused";
  else if (cameraLive && !state.present) chip = "We can't see you";
  setText(refs.cameraChip, chip);
  show(refs.cameraChip, chip !== "");
}

/** The camera started or stopped (whoever did it): tell app.js, redraw. */
function setCameraLive(on) {
  show(refs.cameraOff, !on);
  if (on === cameraLive) return;
  cameraLive = on;
  cameraListeners.forEach((cb) => safeCall(cb, on));
  render();
}

/** Top-bar Camera switch and the "Turn camera on" button in the camera card. */
async function onCameraClick() {
  const camera = services.camera;
  if (cameraStarting || !camera?.startCamera) return;
  if (cameraLive) {
    safeCall(camera.stopCamera); // camera light goes off; the <video> empties
    setCameraLive(false);
    return;
  }
  cameraStarting = true;
  setText(refs.cameraOffText, "Turning the camera on…");
  render();
  try {
    await camera.startCamera(refs.video, refs.canvas);
    setText(refs.cameraOffText, "Camera is off");
  } catch (err) {
    console.error("[ui] startCamera failed:", err);
    setText(refs.cameraOffText, cameraErrorMessage(err));
  } finally {
    cameraStarting = false;
    render();
  }
}

// ─── 1. Welcome: start the camera ───────────────────────────────────────────

async function onStartClick() {
  show(refs.cameraError, false);
  if (!services.camera?.startCamera) {
    // No camera module yet (e.g. in a playground): just move on.
    showScreen("calibrate");
    return;
  }
  refs.startBtn.disabled = true;
  setText(refs.startBtn, "Starting camera…");
  try {
    await services.camera.startCamera(refs.video, refs.canvas);
    showScreen("calibrate");
  } catch (err) {
    console.error("[ui] startCamera failed:", err);
    setText(refs.cameraErrorText, cameraErrorMessage(err));
    show(refs.cameraError, true);
    refs.cameraError.scrollIntoView({ block: "nearest" });
    setText(refs.startBtn, "Try again");
  } finally {
    refs.startBtn.disabled = false;
    if (screen !== "welcome") setText(refs.startBtn, "Start camera");
  }
}

/** Turn a getUserMedia error into a sentence a person can act on. */
function cameraErrorMessage(err) {
  const name = err?.name ?? "";
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  const isMac = /mac/i.test(platform);
  const isWindows = /win/i.test(platform);
  const windowsHelp = "open Settings → Privacy & security → Camera and turn on camera access, including “Let desktop apps access your camera”";
  const macHelp = "open System Settings → Privacy & Security → Camera and allow stretchGoals";

  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) {
    if (isWindows) return `Camera access is blocked. To fix it, ${windowsHelp}, then try again.`;
    if (isMac) return `Camera access is blocked. To fix it, ${macHelp}, then try again.`;
    return `Camera access is blocked. On Windows, ${windowsHelp}. On a Mac, ${macHelp}.`;
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) {
    return "Your camera seems busy. Close other apps that might be using it, like Zoom or Teams, then try again.";
  }
  if (["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"].includes(name)) {
    return "We couldn't find a camera. Check that one is plugged in and turned on, then try again.";
  }
  return isWindows
    ? `Something went wrong starting the camera. Close other apps that use it, like Zoom, or ${windowsHelp}.`
    : "Something went wrong starting the camera. Close other apps that might be using it, like Zoom, then try again.";
}

// ─── 2. Calibration ─────────────────────────────────────────────────────────

const CALIBRATION_REASONS = {
  no_person: "We couldn't see you. Sit where the camera can see your head and both shoulders.",
  low_visibility: "We couldn't see your ears and shoulders clearly. Try more light in front of you.",
  moved: "You moved a bit during calibration. Sit still for the 3 seconds and try again.",
  no_frames: "No camera frames arrived. Check that the camera is on and not paused.",
  cancelled: "Calibration was cancelled.",
};

async function onCalibrateClick() {
  if (calib.phase === "running") return;
  if (paused) setPaused(false); // calibration needs frames
  if (!services.posture?.startCalibration) {
    calib = { phase: "failed", message: "The posture module isn't connected yet, so there's nothing to calibrate. You can skip for now." };
    renderCalibration(lastState);
    return;
  }
  calib = { phase: "running", message: "" };
  ownCalibration = true;
  render();
  let result;
  try {
    result = await services.posture.startCalibration(CALIBRATION_MS);
  } catch (err) {
    console.error("[ui] startCalibration failed:", err);
    result = { ok: false };
  } finally {
    ownCalibration = false;
  }
  if (result?.ok) {
    calibrationSucceeded();
  } else {
    const message = result?.message ?? CALIBRATION_REASONS[result?.reason] ?? "Calibration didn't finish. Please try again.";
    calib = { phase: "failed", message };
    render();
  }
}

function calibrationSucceeded() {
  calib = { phase: "done", message: "" };
  render();
  // Let the "done" tick show for a moment, then go to the dashboard
  setTimeout(() => {
    if (screen === "calibrate" && calib.phase === "done") showScreen("dashboard");
  }, 1200);
}

function renderCalibration(state) {
  const running = calib.phase === "running" || state.calibrating;
  let value = "3 s";
  let verdict = "Ready when you are";
  let message = "We'll remember this as your good posture.";
  let tone = "none";
  let fraction = 0;
  let button = "Start calibration";

  if (running) {
    fraction = state.calibrationProgress;
    tone = "accent";
    value = `${Math.round(clamp01(fraction) * 100)}%`;
    verdict = "Hold still…";
    message = "Nice and tall. Keep still until the ring fills.";
    button = "Calibrating…";
  } else if (calib.phase === "done") {
    fraction = 1;
    value = "";
    tone = "good";
    verdict = "Got it";
    message = "That's your good posture. Taking you to your dashboard…";
  } else if (calib.phase === "failed") {
    tone = "bad";
    value = "!";
    verdict = "Let's try again";
    message = calib.message;
    button = "Try again";
  }

  setRing(refs.calibRingBar, fraction);
  setData(refs.calibRing, "tone", tone);
  setRingValue(refs.calibValue, value);
  setData(refs.calibValue, "icon", calib.phase === "done" && !running ? "check" : "");
  setText(refs.calibVerdict, verdict);
  setText(refs.calibMessage, message);
  setData(refs.calibMessage, "tone", calib.phase === "failed" && !running ? "bad" : "");
  setText(refs.calibBtn, button);
  refs.calibBtn.disabled = running || calib.phase === "done";
}

// ─── 3. Dashboard ───────────────────────────────────────────────────────────

/** Which situation are we in? Decides the score, the messages and the empty states. */
function dashboardMode(state) {
  // (fake posture in dev can be "present" with no camera, so it stays live)
  if (!cameraLive && !state.present && services.camera?.startCamera) return "cameraOff";
  if (paused) return "paused";
  if (!state.present) return "absent";
  if (!state.calibrated) return "uncalibrated";
  if (state.score == null) return "unreadable";
  return "live";
}

const MODE_TEXT = {
  cameraOff: ["Camera is off", "Turn it on to keep watching.", "Your camera is off, so we aren't checking your posture. Turn it back on whenever you're ready."],
  paused: ["Paused", "Resume to keep watching.", "Paused. Resume when you want us to keep an eye on your posture."],
  absent: ["We can't see you", "Move into the camera's view.", "We can't see you right now. Sit where the camera can see your head and both shoulders."],
  uncalibrated: ["Not calibrated yet", "Calibrate to get a score.", "Calibrate first, so we know what your good posture looks like."],
  unreadable: ["Can't read your posture", "Keep both shoulders in view.", "We can see you, but not well enough to measure. Keep your head and both shoulders in view."],
};

function renderDashboard(state) {
  const mode = dashboardMode(state);
  const issues = mode === "live" ? (state.issues ?? []).filter((i) => ISSUES[i.id]) : [];
  // Worst issue = highest severity (posture sorts worst first, but this is cheap insurance)
  const worst = worstIssue(state);

  // Score ring
  if (mode === "live") {
    const score = Math.round(state.score);
    const tone = scoreTone(score);
    setRingValue(refs.scoreValue, score);
    setData(refs.scoreRing, "tone", tone);
    setRing(refs.scoreRingBar, score / 100);
    setText(refs.verdict, tone === "good" ? "Looking good" : tone === "ok" ? "A little off" : "Time to reset");
    setText(refs.subVerdict, worst ? (worst.layman ?? ISSUES[worst.id].layman) : "Right where you calibrated.");
  } else {
    setRingValue(refs.scoreValue, "–");
    setData(refs.scoreRing, "tone", "none");
    setRing(refs.scoreRingBar, 0);
    setText(refs.verdict, MODE_TEXT[mode][0]);
    setText(refs.subVerdict, MODE_TEXT[mode][1]);
  }

  renderIssues(mode, issues, state.metrics?.severity);
  renderTip(worst);
  // While a stretch runs, this button goes back to it (like the dock) instead of starting another
  setText(refs.tipStartLabel, stretchRun ? "Back to stretch" : "Start stretch");
}

function makeIssueRow(id) {
  const li = document.createElement("li");
  li.className = "sg-issue";
  li.dataset.state = "fine";
  li.innerHTML = `
    <div class="sg-issue-names">
      <span class="sg-issue-title"></span>
      <span class="sg-issue-plain"></span>
    </div>
    <div class="sg-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-label="Severity"><span class="sg-bar-fill"></span></div>
    <div class="sg-issue-meta">
      <span class="sg-pill" hidden>Sustained</span>
      <span class="sg-issue-time"></span>
    </div>`;
  const row = {
    li,
    title: li.querySelector(".sg-issue-title"),
    plain: li.querySelector(".sg-issue-plain"),
    bar: li.querySelector(".sg-bar"),
    fill: li.querySelector(".sg-bar-fill"),
    pill: li.querySelector(".sg-pill"),
    time: li.querySelector(".sg-issue-time"),
    severity: "",
  };
  // Names don't change, so set them once. medical is null for too_close.
  const info = ISSUES[id];
  row.title.textContent = info.medical ?? info.layman;
  row.plain.textContent = info.medical ? info.layman : "";
  row.plain.hidden = !info.medical;
  li.title = info.medical ? `${info.medical}: ${info.layman}` : info.layman; // full name if it's cut short
  return row;
}

/**
 * All five posture checks are always listed. Issues detected right now (state.issues)
 * go to the top, worst first, in colour. The others say "Fine" and show a grey bar
 * from metrics.severity, so you can watch a problem build before it's flagged.
 */
function renderIssues(mode, issues, severities) {
  const live = mode === "live";
  setText(refs.issueCount, !live ? "" : issues.length ? `${issues.length} to fix` : "All clear");

  // Not live (paused, nobody there, not calibrated...): one message in the card's frame
  show(refs.issuesEmpty, !live);
  show(refs.issueList, live);
  if (!live) {
    // (camera off: the camera card right above has the "Turn camera on" button)
    const action = { uncalibrated: "Calibrate now", paused: "Resume" }[mode] ?? "";
    setText(refs.issuesEmptyText, MODE_TEXT[mode][2]);
    setText(refs.issuesAction, action);
    show(refs.issuesAction, action !== "");
    return;
  }

  const byId = Object.fromEntries(issues.map((i) => [i.id, i]));
  for (const id of ISSUE_IDS) {
    const row = issueRows[id];
    const issue = byId[id];
    const severity = clamp01(issue ? issue.severity : severities?.[id]);

    const sevKey = severity.toFixed(2);
    if (row.severity !== sevKey) {
      row.severity = sevKey;
      row.fill.style.transform = `scaleX(${sevKey})`;
      row.bar.setAttribute("aria-valuenow", Math.round(severity * 100));
    }
    setData(row.li, "state", !issue ? "fine" : issue.sustained ? "sustained" : "active");
    show(row.pill, Boolean(issue?.sustained));
    setText(row.time, issue ? `for ${Math.max(0, Math.round(issue.durationSec ?? 0))} s` : "Fine");
  }

  // Order: current issues (worst first), then the rest. Only move rows when the order changes.
  const order = [...issues.map((i) => i.id), ...ISSUE_IDS.filter((id) => !byId[id])];
  const key = order.join(",");
  if (key !== issueOrder) {
    issueOrder = key;
    const tops = order.map((id) => issueRows[id].li.getBoundingClientRect().top);
    for (const id of order) refs.issueList.appendChild(issueRows[id].li);
    slideRows(order, tops);
  }
}

/** Moved rows slide from where they were to their new place, so you can see which one went to the top. */
function slideRows(order, tops) {
  if (!refs.issueList.offsetParent || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const easing = getComputedStyle(root).getPropertyValue("--sg-ease-move").trim() || "ease-in-out";
  order.forEach((id, i) => {
    const row = issueRows[id];
    row.slide?.cancel(); // a slide still running: start again from where the row is now
    const dy = tops[i] - row.li.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    row.slide = row.li.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 240, easing });
  });
}

const NO_STRETCH_HOW = "Your health check rules these stretches out. A doctor or physio can suggest ones that suit you.";

/** The suggested stretch, shown on the dashboard card and at the top of the stretch picker. */
function renderTip(worstIssue) {
  const issueId = worstIssue?.id ?? null;
  const key = issueId ?? "none";
  if (suggested?.key === key) return; // nothing changed
  const stretch = stretchFor(issueId);
  suggested = { key, stretch };

  // Their health check rules out every stretch that would fit: say so instead of suggesting one
  show(refs.tipStart, Boolean(stretch));
  if (!stretch) {
    setText(refs.tipLabel, "Suggested stretch");
    setText(refs.tipName, "No stretch for now");
    setText(refs.tipFor, issueId ? `For: ${ISSUES[issueId].layman.toLowerCase()}` : "");
    setData(refs.tipFor, "chip", issueId ? "yes" : "no");
    setText(refs.tipHow, NO_STRETCH_HOW);
    setText(refs.tipTime, "");
    fitTipText(refs.tipHow);
    renderPickSide();
    return;
  }

  const seconds = stretchSeconds(stretch);
  const forText = issueId ? `For: ${ISSUES[issueId].layman.toLowerCase()}` : "Good any time you've been sitting a while.";
  setText(refs.tipLabel, issueId ? "Suggested stretch" : "Quick reset");
  setText(refs.tipName, stretchName(stretch));
  setText(refs.tipFor, forText);
  setData(refs.tipFor, "chip", issueId ? "yes" : "no");
  setText(refs.tipHow, stretchHow(stretch));
  setText(refs.tipTime, seconds ? `About ${seconds} s` : "");
  fitTipText(refs.tipHow);
  renderPickSide();
}

/** The picker's top card: the stretch you clicked, or the suggested one until you pick. */
function renderPickSide() {
  const stretch = picked ?? suggested?.stretch;
  const card = refs.pickName.closest(".sg-card");
  if (!stretch) {
    if (!suggested) return; // nothing chosen yet
    // Their health check rules everything out: no stretch to show, so no Start button
    if (card.dataset.key === "none-suit") return;
    card.dataset.key = "none-suit";
    show(refs.pickStart, false);
    setText(refs.pickLabel, "Suggested for you");
    setText(refs.pickName, "No stretch for now");
    setText(refs.pickFor, "");
    setData(refs.pickFor, "chip", "no");
    setText(refs.pickHow, NO_STRETCH_HOW);
    setText(refs.pickTime, "");
    fitTipText(refs.pickHow);
    return;
  }
  show(refs.pickStart, true);
  const issueId = picked || suggested.key === "none" ? null : suggested.key;
  const key = `${picked ? "picked" : issueId ?? "none"}:${stretch.id}`;
  if (card.dataset.key === key) return; // nothing changed
  card.dataset.key = key;

  // A picked stretch says what it helps; a suggestion says which of your issues it's for
  const helps = (stretch.helps ?? []).map((id) => ISSUES[id]?.layman.toLowerCase()).filter(Boolean);
  const forText = issueId ? `For: ${ISSUES[issueId].layman.toLowerCase()}` : picked && helps.length ? `For: ${helps.join(", ")}` : "Good any time you've been sitting a while.";
  const seconds = stretchSeconds(stretch);
  setText(refs.pickLabel, picked ? "Your pick" : issueId ? "Suggested for you" : "Quick reset");
  setText(refs.pickName, stretchName(stretch));
  setText(refs.pickFor, forText);
  setData(refs.pickFor, "chip", forText.startsWith("For:") ? "yes" : "no");
  setText(refs.pickHow, stretchHow(stretch));
  setText(refs.pickTime, seconds ? `About ${seconds} s` : "");
  fitTipText(refs.pickHow);
  // Tick the one shown in the card
  for (const button of refs.pickList.querySelectorAll(".sg-pick")) {
    const selected = button.dataset.stretchId === stretch.id;
    setData(button, "selected", selected ? "yes" : "no");
    button.setAttribute("aria-pressed", String(selected));
  }
}

/** A suggested-stretch description shows as many whole lines as fit its card (up to 4), or none. */
function fitTipText(howEl) {
  const card = howEl.closest(".sg-card");
  if (!card.offsetParent) return; // not on screen; the ResizeObserver runs this when it shows
  howEl.hidden = false;
  howEl.style.webkitLineClamp = "4";
  const over = card.scrollHeight - card.clientHeight;
  if (over <= 0) return;
  const lineHeight = parseFloat(getComputedStyle(howEl).lineHeight) || 21;
  const lines = Math.round(howEl.offsetHeight / lineHeight) - Math.ceil(over / lineHeight);
  if (lines > 0) howEl.style.webkitLineClamp = String(lines);
  else howEl.hidden = true;
}

/** The worst issue right now, or null (also null when not live). */
function worstIssue(state) {
  if (dashboardMode(state) !== "live") return null;
  const issues = (state.issues ?? []).filter((i) => ISSUES[i.id]);
  return issues.reduce((a, b) => (b.severity > (a?.severity ?? -1) ? b : a), null);
}

function renderPicker() {
  renderTip(worstIssue(lastState));
  renderPickSide();
}

// ─── 4. Guided stretch ──────────────────────────────────────────────────────

/** Start the suggested stretch (dashboard card, dock, picker's big button). */
function onStartStretchClick() {
  if (!suggested) renderTip(null); // e.g. "Stretch now" before the dashboard has picked one
  if (!suggested?.stretch) {
    showScreen("stretch"); // none suit their health check: the stretch screen says so
    return;
  }
  startStretch(suggested.stretch);
}

function startStretch(stretch) {
  if (!stretch?.id) return;
  // Never start one their health check rules out, and don't open the screen if it refuses
  if (services.safety && !services.safety.isAllowed(stretch.id)) return;
  picked = null;
  const firstSeconds = Number(stretch.steps?.[0]?.seconds) || 0;
  stretchRun = { id: stretch.id, stretch, stepIndex: 0, secondsLeft: firstSeconds, stepTotal: firstSeconds };
  if (safeCall(stretches?.startStretch, stretch.id) === false) {
    stretchRun = null;
    render();
    return;
  }
  showScreen("stretch");
}

/** Dock and dashboard buttons: start one, or go back to the one that's running. */
function onDockStretchClick() {
  if (stretchRun) showScreen("stretch");
  else onStartStretchClick();
}

function stopRunningStretch() {
  if (!stretchRun) return;
  stretchRun = null;
  safeCall(stretches?.stopStretch); // sends "end"
}

function onStopStretchClick() {
  showScreen("dashboard");
  stopRunningStretch();
  render();
}

/** Joseph's stretch events: { type: "start" | "step" | "tick" | "end", stretchId, stepIndex, secondsLeft } */
function onStretchEvent(event) {
  if (!event || !root) return;
  if (event.type === "end") {
    stretchRun = null;
    if (screen === "stretch") showScreen("dashboard");
    else render();
    return;
  }
  if (!stretchRun || stretchRun.id !== event.stretchId) {
    const stretch = findStretch(event.stretchId);
    stretchRun = { id: event.stretchId, stretch, stepIndex: -1, secondsLeft: 0, stepTotal: 0 };
  }
  const stepIndex = Number(event.stepIndex) || 0;
  const secondsLeft = Math.max(0, Number(event.secondsLeft) || 0);
  if (event.type === "start" || event.type === "step" || stepIndex !== stretchRun.stepIndex) {
    // New step: its full length is in the data, or else the first countdown number we see
    stretchRun.stepTotal = Number(stretchRun.stretch.steps?.[stepIndex]?.seconds) || secondsLeft;
  }
  stretchRun.stepIndex = stepIndex;
  stretchRun.secondsLeft = secondsLeft;
  stretchRun.stepTotal = Math.max(stretchRun.stepTotal, secondsLeft);

  // Only a new stretch (e.g. started by voice) opens the screen. Ticks never pull you back
  // to it, so you can look at the dashboard or calibrate while one runs.
  if (event.type === "start" && screen !== "stretch") showScreen("stretch");
  else if (screen === "stretch") renderStretch();
  else renderHeader();
}

/** The picker's list: one button per stretch, made once in mount. */
function buildPickList() {
  // With a health check the list is already only the stretches that suit them; none may be left
  const list = services.safety || allStretches().length ? allStretches() : FALLBACK_STRETCHES;
  refs.pickList.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "sg-pick-none";
    li.textContent = "None of these suit your health check right now.";
    refs.pickList.appendChild(li);
    return;
  }
  for (const stretch of list) {
    // "Hunched over, one shoulder higher than the other"
    const helps = (stretch.helps ?? []).map((id) => ISSUES[id]?.layman).filter(Boolean);
    const helpsText = helps.map((text, i) => (i ? text.charAt(0).toLowerCase() + text.slice(1) : text)).join(", ");
    const seconds = stretchSeconds(stretch);
    const li = document.createElement("li");
    li.innerHTML = `
      <button type="button" class="sg-pick" data-stretch-id="${stretch.id}">
        <span class="sg-pick-text">
          <span class="sg-pick-name"></span>
          <span class="sg-pick-meta"></span>
        </span>
        <span class="sg-pick-mark">${ICON.check}</span>
      </button>`;
    li.querySelector(".sg-pick-name").textContent = stretchName(stretch);
    // Time first, so it's never the part cut short: "35 s · Neck too far forward"
    li.querySelector(".sg-pick-meta").textContent = [seconds ? `${seconds} s` : "", helpsText || "Any time"].filter(Boolean).join(" · ");
    li.querySelector(".sg-pick").title = helpsText ? `Choose ${stretchName(stretch)}. Helps: ${helpsText.toLowerCase()}` : `Choose ${stretchName(stretch)}`;
    refs.pickList.appendChild(li);
  }
}

function renderStretch() {
  if (!stretchRun) {
    renderPicker();
    return;
  }
  const { stretch, stepIndex, secondsLeft, stepTotal } = stretchRun;
  const steps = Array.isArray(stretch.steps) ? stretch.steps : [];
  setText(refs.stretchName, stretchName(stretch));
  setText(refs.stretchStep, stepText(steps[stepIndex]) || "Follow the steps with the voice.");
  // A new step of the same stretch: its words rise in, so you notice the change while looking away
  if (shownStep?.run === stretchRun && shownStep.index !== stepIndex) {
    refs.stretchStep.classList.remove("sg-step-new");
    void refs.stretchStep.offsetWidth; // restart the animation
    refs.stretchStep.classList.add("sg-step-new");
  }
  shownStep = { run: stretchRun, index: stepIndex };
  const next = stepText(steps[stepIndex + 1]);
  setText(refs.stretchNext, steps.length ? (next ? `Up next: ${next}` : "Last step. Nearly done.") : "");
  setText(refs.stretchStepOf, steps.length ? `Step ${stepIndex + 1} of ${steps.length}` : "");
  setRingValue(refs.stretchValue, secondsLeft ? `${secondsLeft}` : "");
  setData(refs.stretchRing, "tone", "accent");
  setRing(refs.stretchRingBar, stepTotal ? secondsLeft / stepTotal : 0);
}

// ─── 5. Settings ────────────────────────────────────────────────────────────

let lastFocus = null;

function openSettings() {
  lastFocus = document.activeElement;
  show(refs.scrim, true);
  show(refs.settings, true);
  // `inert` stops Tab from wandering behind the panel
  refs.main.inert = true;
  refs.headerTools.inert = true;
  refs.rail.inert = true;
  refs.settingsClose.focus();
}

function closeSettings() {
  if (refs.settings.hidden) return;
  show(refs.scrim, false);
  show(refs.settings, false);
  refs.main.inert = false;
  refs.headerTools.inert = false;
  refs.rail.inert = false;
  lastFocus?.focus?.();
}

function applyVoice() {
  refs.voiceToggle.checked = settings.voiceOn;
  safeCall(services.voice?.voiceCoach?.setMuted, !settings.voiceOn);
}

function applySensitivity() {
  refs.sensitivity.value = String(settings.sensitivity);
  const s = settings.sensitivity;
  setText(refs.sensitivityValue, s < 0.34 ? "Relaxed" : s > 0.66 ? "Strict" : "Balanced");
  safeCall(services.posture?.setSensitivity, settings.sensitivity);
}

function onRecalibrateClick() {
  safeCall(services.posture?.resetCalibration);
  closeSettings();
  calib = { phase: "idle", message: "" };
  if (paused) setPaused(false);
  showScreen("calibrate");
}

// ─── Pause ──────────────────────────────────────────────────────────────────

function setPaused(value) {
  const next = Boolean(value);
  if (next === paused) return;
  paused = next;
  pauseListeners.forEach((cb) => safeCall(cb, paused));
  if (root) render();
}

// ─── mount + update ─────────────────────────────────────────────────────────

/** Adds ui.css to the page once (works with Vite and with a plain static server). */
function addStylesheet() {
  if (document.querySelector("link[data-sg-ui]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./ui.css", import.meta.url).href;
  link.dataset.sgUi = "";
  document.head.appendChild(link);

  // Display face for titles and big numbers: Unbounded (OFL-1.1, see fonts/OFL.txt), bundled so it
  // works offline. new URL(...) lets Vite copy it into the packaged app.
  const fontUrl = new URL("./fonts/unbounded.woff2", import.meta.url).href;
  const face = new FontFace("Unbounded", `url("${fontUrl}") format("woff2")`, { weight: "200 900", display: "swap" });
  document.fonts.add(face);
  face.load().catch(() => {}); // if it fails, the system font is used instead
}

// ─── Health check (Settings) ────────────────────────────────────────────────

/**
 * One tick box per condition (services.safety.CONDITIONS). "Ask first" conditions get a second
 * box, "A doctor or physio has cleared me", shown while the condition is ticked. Every change is
 * saved and re-checked with IndyKite; the suggested stretch and the picker follow the answer.
 */
function buildHealthCheck(safety) {
  show(refs.healthSetting, true);
  const boxes = {}; // condition id -> { has, cleared? }
  const { conditions, cleared } = safety.get();

  const box = (label, checked) => {
    const wrap = document.createElement("label");
    wrap.className = "sg-health-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const text = document.createElement("span");
    text.textContent = label;
    wrap.append(input, text);
    return { wrap, input };
  };

  const save = () => {
    const ticked = Object.keys(boxes).filter((id) => boxes[id].has.input.checked);
    const ok = ticked.filter((id) => boxes[id].cleared?.input.checked);
    for (const { has, cleared: box } of Object.values(boxes)) if (box) show(box.wrap, has.input.checked);
    safety.set({ conditions: ticked, cleared: ok });
  };

  refs.healthList.replaceChildren(
    ...safety.CONDITIONS.map((c) => {
      const li = document.createElement("li");
      const has = box(c.label, conditions.includes(c.id));
      has.input.addEventListener("change", save);
      li.append(has.wrap);
      boxes[c.id] = { has };
      if (c.level === "ask_first") {
        const ok = box("A doctor or physio has cleared me", cleared.includes(c.id));
        ok.wrap.classList.add("sg-health-cleared");
        ok.input.addEventListener("change", save);
        show(ok.wrap, has.input.checked);
        li.append(ok.wrap);
        boxes[c.id].cleared = ok;
      }
      return li;
    }),
  );

  const renderStatus = (s) => {
    setText(refs.healthStatus, s.source === "checking" ? "Checking…" : `${s.allowed} of ${s.total} stretches suit you`);
    setText(
      refs.healthSource,
      s.source === "indykite"
        ? "Checked by IndyKite."
        : s.source === "local"
          ? "Checked on this computer (IndyKite couldn't be reached)."
          : "",
    );
    // The answer changed which stretches suit them: pick the suggested one and redraw the picker
    suggested = null;
    if (stretchRun && !safety.isAllowed(stretchRun.id)) stopRunningStretch();
    if (picked && !safety.isAllowed(picked.id)) picked = null;
    delete refs.pickName.closest(".sg-card").dataset.key;
    buildPickList();
    if (screen === "dashboard" || screen === "stretch") render();
  };
  safety.onChange(renderStatus);
  renderStatus(safety.status());
}

function mount(el, givenServices = {}) {
  if (root) {
    console.warn("[ui] ui.mount() was called twice; ignoring the second call.");
    return;
  }
  addStylesheet();
  services = givenServices ?? {};
  stretches = services.stretches ?? createFallbackStretches();

  // Safety net: if nobody gave `el` a height (it's empty, so it measures 0), fill the window.
  if (el.getBoundingClientRect().height < 1) el.style.height = "100vh";

  el.classList.add("sg-host");
  el.innerHTML = TEMPLATE;
  root = el.querySelector(".sg-app");
  root.querySelectorAll("[data-ref]").forEach((node) => (refs[node.dataset.ref] = node));
  refs.video = root.querySelector("#camera-video");
  refs.canvas = root.querySelector("#camera-overlay");
  refs.navButtons = [...root.querySelectorAll("[data-nav]")];

  // Issue rows: made once, shown/hidden by update()
  for (const id of ISSUE_IDS) {
    issueRows[id] = makeIssueRow(id);
    refs.issueList.appendChild(issueRows[id].li);
  }

  // "Camera is off" sits behind the video until frames arrive
  refs.video.addEventListener("playing", () => setCameraLive(true));
  refs.video.addEventListener("emptied", () => setCameraLive(false));

  // Buttons
  refs.startBtn.addEventListener("click", onStartClick);
  refs.cameraBtn.addEventListener("click", onCameraClick);
  refs.status.addEventListener("click", onCameraClick); // the status pill toggles the camera too
  refs.cameraOffBtn.addEventListener("click", onCameraClick);
  refs.calibBtn.addEventListener("click", onCalibrateClick);
  refs.skipBtn.addEventListener("click", () => showScreen("dashboard"));
  refs.tipStart.addEventListener("click", onDockStretchClick); // start one, or go back to the one running
  // Picker: clicking a stretch only chooses it; its Start button begins the countdown
  refs.pickStart.addEventListener("click", () => {
    if (!suggested) renderTip(null);
    startStretch(picked ?? suggested?.stretch);
  });
  refs.pickList.addEventListener("click", (e) => {
    const pick = e.target.closest(".sg-pick");
    if (!pick) return;
    picked = findStretch(pick.dataset.stretchId);
    renderPickSide();
    refs.pickStart.focus({ preventScroll: true }); // so Enter starts it
  });
  refs.stopBtn.addEventListener("click", onStopStretchClick);
  refs.issuesAction.addEventListener("click", () => {
    if (paused) setPaused(false);
    else showScreen("calibrate");
  });
  refs.pauseBtn.addEventListener("click", () => setPaused(!paused));
  refs.settingsPause.addEventListener("click", () => setPaused(!paused));
  refs.settingsBtn.addEventListener("click", openSettings);
  refs.settingsClose.addEventListener("click", closeSettings);
  refs.scrim.addEventListener("click", closeSettings);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });
  refs.recalibrateBtn.addEventListener("click", onRecalibrateClick);

  // Rail: each item just opens its screen (Stretches shows the picker, or the running stretch)
  for (const button of refs.navButtons) {
    button.addEventListener("click", () => showScreen(button.dataset.nav));
  }
  refs.dockStretch.addEventListener("click", onDockStretchClick);

  // Theme: the top-bar button flips light/dark; Settings also offers "System"
  refs.themeBtn.addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark"));
  refs.themeChoices.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-theme-choice]");
    if (choice) setTheme(choice.dataset.themeChoice);
  });
  darkQuery?.addEventListener?.("change", () => {
    if (settings.theme === "system") applyTheme();
  });
  refs.voiceToggle.addEventListener("change", () => {
    settings.voiceOn = refs.voiceToggle.checked;
    saveSettings();
    applyVoice();
  });
  refs.sensitivity.addEventListener("input", () => {
    settings.sensitivity = clamp01(refs.sensitivity.value);
    saveSettings();
    applySensitivity();
  });

  // Stretch events (Joseph's module, or the fallback)
  safeCall(stretches.onStretchEvent, onStretchEvent);
  buildPickList();
  if (services.safety) buildHealthCheck(services.safety);
  // Refit the suggested-stretch text whenever its card changes size (window resize, screen change)
  const tipObserver = new ResizeObserver(() => {
    fitTipText(refs.tipHow);
    fitTipText(refs.pickHow);
  });
  tipObserver.observe(refs.tipHow.closest(".sg-card"));
  tipObserver.observe(refs.pickHow.closest(".sg-card"));

  // Saved settings → apply them to the modules now
  loadSettings();
  applyTheme();
  applyVoice();
  applySensitivity();

  showScreen("welcome");
}

function update(state) {
  if (!root || !state) return;
  lastState = state;

  // A calibration just started. If our Calibrate button didn't start it (e.g. the tray did),
  // jump to the calibration screen so the person sees the ring.
  if (state.calibrating && !wasCalibrating) {
    externalCalibration = !ownCalibration;
    if (externalCalibration) {
      calib = { phase: "running", message: "" };
      if (screen !== "calibrate") showScreen("calibrate");
    }
  }
  // That outside calibration finished. We never see its result, so read it from the state.
  // (Our own button's result is handled in onCalibrateClick.)
  if (!state.calibrating && wasCalibrating && externalCalibration) {
    externalCalibration = false;
    if (screen === "calibrate") {
      if (state.calibrated) calibrationSucceeded();
      else calib = { phase: "failed", message: "Calibration didn't finish. Sit tall and try again." };
    }
  }
  wasCalibrating = state.calibrating;

  render();
}

export const ui = {
  mount,
  update,
  onPauseChange(cb) {
    pauseListeners.add(cb);
    return () => pauseListeners.delete(cb);
  },
  setPaused,
  isPaused: () => paused,
  showScreen,
  onCameraChange(cb) {
    cameraListeners.add(cb);
    return () => cameraListeners.delete(cb);
  },
};
