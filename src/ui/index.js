/**
 * stretchGoals UI screens (owner: Claude via Darren). Plain JS, no framework.
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
 *                            use showScreen("calibrate").
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
let settings = { voiceOn: true, sensitivity: DEFAULT_SENSITIVITY };

// Calibration: idle → running → done | failed
let calib = { phase: "idle", message: "" };
let wasCalibrating = false;
let ownCalibration = false; // true while OUR Calibrate button's startCalibration() is running
let externalCalibration = false; // true while a calibration someone else started is running

// The stretch that's running right now, or null
let stretchRun = null;
// The stretch the dashboard is suggesting
let suggested = null;

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
  return allStretches().find((s) => s.id === id) ?? FALLBACK_STRETCHES.find((s) => s.id === id) ?? { id };
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

/** The first stretch that helps this issue, or a general one when there's no issue. */
function stretchFor(issueId) {
  if (issueId) {
    const list = safeCall(stretches?.stretchesFor, issueId);
    if (Array.isArray(list) && list.length) return list[0];
    const backup = FALLBACK_STRETCHES.find((s) => s.helps.includes(issueId));
    if (backup) return findStretch(backup.id);
  }
  return findStretch("shoulder_rolls");
}

// ─── Icons (outline, 16px) ──────────────────────────────────────────────────

const ICON = {
  mark: `<svg class="sg-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="1.5" width="7" height="4.2" rx="2.1"/><rect x="7" y="7.2" width="10" height="4.2" rx="2.1"/><rect x="7" y="12.9" width="10" height="4.2" rx="2.1"/><rect x="8.5" y="18.6" width="7" height="3.9" rx="1.95"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M9 6v12M15 6v12"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M8 5.5v13l10-6.5z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon sg-icon-lg"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
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
<div class="sg-app" data-screen="welcome">
  <header class="sg-header">
    <div class="sg-brand">${ICON.mark}<span class="sg-brand-name">stretchGoals</span></div>
    <div class="sg-header-tools" data-ref="headerTools">
      <span class="sg-status" data-ref="status" data-tone="good"><span class="sg-status-dot"></span><span data-ref="statusText">Watching</span></span>
      <button type="button" class="sg-btn sg-btn-quiet" data-ref="pauseBtn">
        <span data-ref="pauseIcon">${ICON.pause}</span><span data-ref="pauseLabel">Pause</span>
      </button>
      <button type="button" class="sg-btn sg-btn-quiet" data-ref="settingsBtn" aria-haspopup="dialog">
        ${ICON.sliders}<span>Settings</span>
      </button>
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
        <div class="sg-camera-off" data-ref="cameraOff">Camera is off</div>
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
              <button type="button" class="sg-btn sg-btn-primary" data-ref="calibBtn">Calibrate</button>
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
            <button type="button" class="sg-btn sg-btn-primary" data-ref="tipStart">Start</button>
            <span class="sg-note" data-ref="tipTime"></span>
          </div>
        </section>
      </div>

      <!-- 4. Guided stretch -->
      <div class="sg-screen" data-for="stretch">
        <section class="sg-card sg-side" aria-label="Time left in this step">
          <p class="sg-label">This step</p>
          ${ring("stretchRing", "stretchValue")}
          <p class="sg-verdict" data-ref="stretchStepOf"></p>
        </section>
        <section class="sg-card sg-panel sg-guide" aria-labelledby="sg-guide-title">
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

  <!-- 5. Settings (a panel that slides over the screen) -->
  <div class="sg-scrim" data-ref="scrim" hidden></div>
  <aside class="sg-settings" data-ref="settings" role="dialog" aria-modal="true" aria-labelledby="sg-settings-title" hidden>
    <div class="sg-settings-head">
      <h2 id="sg-settings-title" class="sg-h2">Settings</h2>
      <button type="button" class="sg-btn sg-btn-icon" data-ref="settingsClose" aria-label="Close settings">${ICON.close}</button>
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
  </aside>
</div>`;

// ─── Screens ────────────────────────────────────────────────────────────────

function showScreen(name) {
  if (!root || !SCREENS.includes(name)) return;
  screen = name;
  setData(root, "screen", name);
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
  let text = "Watching";
  let tone = "good";
  if (paused) [text, tone] = ["Paused", "off"];
  else if (screen === "calibrate" && (calib.phase === "running" || lastState.calibrating)) text = "Calibrating";
  else if (screen === "stretch") text = "Stretching";
  setText(refs.statusText, text);
  setData(refs.status, "tone", tone);
  // Pause button: icon + label
  const label = paused ? "Resume" : "Pause";
  if (refs.pauseLabel.textContent !== label) {
    refs.pauseLabel.textContent = label;
    refs.pauseIcon.innerHTML = paused ? ICON.play : ICON.pause;
    refs.settingsPause.textContent = label;
    refs.settingsPauseDesc.textContent = paused
      ? "Paused. Posture checks are off until you resume."
      : "Stops posture checks until you resume.";
  }
}

function renderCamera(state) {
  let chip = "";
  if (paused) chip = "Paused";
  else if (refs.cameraOff.hidden && !state.present) chip = "We can't see you";
  setText(refs.cameraChip, chip);
  show(refs.cameraChip, chip !== "");
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
  let button = "Calibrate";

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
  setText(refs.calibValue, value);
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
  if (paused) return "paused";
  if (!state.present) return "absent";
  if (!state.calibrated) return "uncalibrated";
  if (state.score == null) return "unreadable";
  return "live";
}

const MODE_TEXT = {
  paused: ["Paused", "Resume to keep watching.", "Paused. Resume when you want us to keep an eye on your posture."],
  absent: ["We can't see you", "Move into the camera's view.", "We can't see you right now. Sit where the camera can see your head and both shoulders."],
  uncalibrated: ["Not calibrated yet", "Calibrate to get a score.", "Calibrate first, so we know what your good posture looks like."],
  unreadable: ["Can't read your posture", "Keep both shoulders in view.", "We can see you, but not well enough to measure. Keep your head and both shoulders in view."],
};

function renderDashboard(state) {
  const mode = dashboardMode(state);
  const issues = mode === "live" ? (state.issues ?? []).filter((i) => ISSUES[i.id]) : [];
  // Worst issue = highest severity (posture sorts worst first, but this is cheap insurance)
  const worst = issues.reduce((a, b) => (b.severity > (a?.severity ?? -1) ? b : a), null);

  // Score ring
  if (mode === "live") {
    const score = Math.round(state.score);
    const tone = scoreTone(score);
    setText(refs.scoreValue, score);
    setData(refs.scoreRing, "tone", tone);
    setRing(refs.scoreRingBar, score / 100);
    setText(refs.verdict, tone === "good" ? "Looking good" : tone === "ok" ? "A little off" : "Time to reset");
    setText(refs.subVerdict, worst ? (worst.layman ?? ISSUES[worst.id].layman) : "Right where you calibrated.");
  } else {
    setText(refs.scoreValue, "–");
    setData(refs.scoreRing, "tone", "none");
    setRing(refs.scoreRingBar, 0);
    setText(refs.verdict, MODE_TEXT[mode][0]);
    setText(refs.subVerdict, MODE_TEXT[mode][1]);
  }

  renderIssues(mode, issues, state.metrics?.severity);
  renderTip(worst);
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
    const action = mode === "uncalibrated" ? "Calibrate" : mode === "paused" ? "Resume" : "";
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
    for (const id of order) refs.issueList.appendChild(issueRows[id].li);
  }
}

function renderTip(worstIssue) {
  const issueId = worstIssue?.id ?? null;
  const key = issueId ?? "none";
  if (suggested?.key === key) return; // nothing changed
  const stretch = stretchFor(issueId);
  suggested = { key, stretch };

  setText(refs.tipLabel, issueId ? "Suggested stretch" : "Quick reset");
  setText(refs.tipName, stretchName(stretch));
  setText(refs.tipFor, issueId ? `For: ${ISSUES[issueId].layman.toLowerCase()}` : "Good any time you've been sitting a while.");
  setText(refs.tipHow, stretchHow(stretch));
  const seconds = stretchSeconds(stretch);
  setText(refs.tipTime, seconds ? `About ${seconds} s` : "");
}

// ─── 4. Guided stretch ──────────────────────────────────────────────────────

function onStartStretchClick() {
  const stretch = suggested?.stretch;
  if (!stretch?.id) return;
  const firstSeconds = Number(stretch.steps?.[0]?.seconds) || 0;
  stretchRun = { id: stretch.id, stretch, stepIndex: 0, secondsLeft: firstSeconds, stepTotal: firstSeconds };
  showScreen("stretch");
  safeCall(stretches?.startStretch, stretch.id);
}

function onStopStretchClick() {
  stretchRun = null;
  safeCall(stretches?.stopStretch);
  showScreen("dashboard");
}

/** Joseph's stretch events: { type: "start" | "step" | "tick" | "end", stretchId, stepIndex, secondsLeft } */
function onStretchEvent(event) {
  if (!event || !root) return;
  if (event.type === "end") {
    stretchRun = null;
    if (screen === "stretch") showScreen("dashboard");
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

  if (screen !== "stretch") showScreen("stretch");
  else renderStretch();
}

function renderStretch() {
  if (!stretchRun) return;
  const { stretch, stepIndex, secondsLeft, stepTotal } = stretchRun;
  const steps = Array.isArray(stretch.steps) ? stretch.steps : [];
  setText(refs.stretchName, stretchName(stretch));
  setText(refs.stretchStep, stepText(steps[stepIndex]) || "Follow the steps with the voice.");
  const next = stepText(steps[stepIndex + 1]);
  setText(refs.stretchNext, steps.length ? (next ? `Up next: ${next}` : "Last step. Nearly done.") : "");
  setText(refs.stretchStepOf, steps.length ? `Step ${stepIndex + 1} of ${steps.length}` : "");
  setText(refs.stretchValue, secondsLeft ? `${secondsLeft}` : "");
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
  refs.settingsClose.focus();
}

function closeSettings() {
  if (refs.settings.hidden) return;
  show(refs.scrim, false);
  show(refs.settings, false);
  refs.main.inert = false;
  refs.headerTools.inert = false;
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

  // Issue rows: made once, shown/hidden by update()
  for (const id of ISSUE_IDS) {
    issueRows[id] = makeIssueRow(id);
    refs.issueList.appendChild(issueRows[id].li);
  }

  // "Camera is off" sits behind the video until frames arrive
  refs.video.addEventListener("playing", () => {
    show(refs.cameraOff, false);
    renderCamera(lastState);
  });
  refs.video.addEventListener("emptied", () => show(refs.cameraOff, true));

  // Buttons
  refs.startBtn.addEventListener("click", onStartClick);
  refs.calibBtn.addEventListener("click", onCalibrateClick);
  refs.skipBtn.addEventListener("click", () => showScreen("dashboard"));
  refs.tipStart.addEventListener("click", onStartStretchClick);
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

  // Saved settings → apply them to the modules now
  loadSettings();
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
};
