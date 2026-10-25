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

import { ISSUES, ISSUE_IDS, emptyPostureState } from '../shared/contracts.js';
import {
  FALLBACK_STRETCHES,
  createFallbackStretches,
} from './fallback-stretches.js';
import {
  EASE_OUT,
  flip,
  glide,
  measure,
  play,
  reducedMotion,
  springEasing,
} from './motion.js';
import { createSession } from './session.js';

// ─── Settings you might want to tweak ───────────────────────────────────────
const SCORE_GOOD = 80; // score >= 80 is green
const SCORE_OK = 50; //   score >= 50 is yellow, below that is red
const DEFAULT_SENSITIVITY = 0.5;
const CALIBRATION_MS = 3000;
const SCREENS = ['welcome', 'calibrate', 'dashboard', 'stretch'];
const STORAGE_KEY = 'stretchGoals.ui.settings';

// ─── Everything the UI remembers ────────────────────────────────────────────
let root = null; // the .sg-app element
let refs = {}; // named elements, found once by their data-ref attribute
let services = {}; // { posture, voice, stretches, camera }
let stretches = null; // Joseph's module, or the fallback
let screen = 'welcome';
let lastState = emptyPostureState();
let paused = false;
const pauseListeners = new Set();
let settings = {
  voiceOn: true,
  sensitivity: DEFAULT_SENSITIVITY,
  overlayOn: true,
};

// Calibration: idle → running → done | failed
let calib = { phase: 'idle', message: '' };
let wasCalibrating = false;
let ownCalibration = false; // true while OUR Calibrate button's startCalibration() is running
let externalCalibration = false; // true while a calibration someone else started is running

// The stretch that's running right now, or null
let stretchRun = null;
// The stretch the dashboard is suggesting
let suggested = null;

// One row per issue, made once and then shown/hidden (no rebuilding each frame)
const issueRows = {};
let issueOrder = '';

let session = null; // this session's numbers and sparkline (./session.js)

// ─── Small helpers ──────────────────────────────────────────────────────────

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/** Only touch the DOM when the text really changed. */
function setText(el, text) {
  const value = String(text ?? '');
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
  if (score >= SCORE_GOOD) return 'good';
  if (score >= SCORE_OK) return 'ok';
  return 'bad';
}

/** Call a service function without letting a teammate's bug crash the UI. */
function safeCall(fn, ...args) {
  try {
    return fn?.(...args);
  } catch (err) {
    console.error('[ui] service call failed:', err);
    return undefined;
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (typeof saved.voiceOn === 'boolean') settings.voiceOn = saved.voiceOn;
    if (typeof saved.overlayOn === 'boolean')
      settings.overlayOn = saved.overlayOn;
    if (typeof saved.sensitivity === 'number')
      settings.sensitivity = clamp01(saved.sensitivity);
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
  return (
    allStretches().find((s) => s.id === id) ??
    FALLBACK_STRETCHES.find((s) => s.id === id) ?? { id }
  );
}

function stretchName(s) {
  if (s?.name || s?.title) return s.name ?? s.title;
  const id = String(s?.id ?? 'Stretch').replace(/_/g, ' ');
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function stepText(step) {
  if (typeof step === 'string') return step;
  return step?.text ?? step?.say ?? step?.instruction ?? '';
}

function stretchHow(s) {
  return s?.how ?? s?.description ?? stepText(s?.steps?.[0]) ?? '';
}

function stretchSeconds(s) {
  if (!Array.isArray(s?.steps)) return s?.seconds ?? null;
  const total = s.steps.reduce(
    (sum, step) => sum + (Number(step?.seconds) || 0),
    0,
  );
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
  return findStretch('shoulder_rolls');
}

/** "12 s", "3 min 20 s", "2 h 05 min": how long an issue has lasted. */
function duration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  if (s < 3600)
    return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}

// ─── Icons (outline, 1.6 stroke, drawn on a 24 grid) ────────────────────────

const ICON = {
  mark: `<svg class="sg-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="1.5" width="7" height="4.2" rx="2.1"/><rect x="7" y="7.2" width="10" height="4.2" rx="2.1"/><rect x="7" y="12.9" width="10" height="4.2" rx="2.1"/><rect x="8.5" y="18.6" width="7" height="3.9" rx="1.95"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M9 6v12M15 6v12"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M8 5.5v13l10-6.5z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  lens: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon sg-icon-lg"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true" class="sg-icon"><path d="M5 12h13M13 7l5 5-5 5"/></svg>`,
};

// A hand-drawn-feel check and a pen ellipse, drawn with stroke-dashoffset (pathLength = 1)
const CHECK_PATH = `<path class="sg-draw" pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/>`;
const PEN_RING = `<svg class="sg-pen" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path class="sg-draw" pathLength="1" d="M8 22C6 9 40 3 66 5s31 10 28 20-34 13-58 11S4 30 14 13"/></svg>`;

/** A ring of tick marks (like a dial's minute track). Built once; ticks light up via a class. */
function tickRing(ref, count, radius = 54) {
  let ticks = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const major = i % (count / 4) === 0;
    const r1 = radius - (major ? 9 : 5);
    const p = (r) =>
      `${(60 + Math.cos(a) * r).toFixed(2)} ${(60 + Math.sin(a) * r).toFixed(2)}`;
    ticks += `<path class="sg-tick${major ? ' sg-tick-major' : ''}" d="M${p(r1)}L${p(radius)}"/>`;
  }
  return `<svg viewBox="0 0 120 120" class="sg-dial" aria-hidden="true"><g data-ref="${ref}">${ticks}</g></svg>`;
}

/** The 0–100 ruler under the score: a tick every 2, labels at the tone lines. */
function scoreRuler() {
  let ticks = '';
  for (let v = 0; v <= 100; v += 2) {
    const major = v % 10 === 0;
    ticks += `<line x1="${v * 2}" x2="${v * 2}" y1="${major ? 0 : 4}" y2="12" class="${major ? 'sg-rule-major' : 'sg-rule-minor'}"/>`;
  }
  // Labels are HTML, not SVG text: the ruler stretches to fit, and stretched text looks wrong
  const label = (v) => `<span style="left: ${v}%">${v}</span>`;
  return `
    <svg class="sg-ruler" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
      <rect class="sg-zone sg-zone-bad" x="0" y="0" width="${SCORE_OK * 2}" height="12"/>
      <rect class="sg-zone sg-zone-ok" x="${SCORE_OK * 2}" y="0" width="${(SCORE_GOOD - SCORE_OK) * 2}" height="12"/>
      <rect class="sg-zone sg-zone-good" x="${SCORE_GOOD * 2}" y="0" width="${(100 - SCORE_GOOD) * 2}" height="12"/>
      ${ticks}
    </svg>
    <span class="sg-ruler-labels">${label(0)}${label(SCORE_OK)}${label(SCORE_GOOD)}${label(100)}</span>`;
}

/** Score digits that roll like a counter (a "number ticker"): one strip of 0–9 per column. */
const DIGITS = Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join(
  '',
);
const digitColumn = (ref) =>
  `<span class="sg-digit" data-ref="${ref}"><span class="sg-digit-strip">${DIGITS}</span></span>`;

// ─── The screens, as HTML (built once in mount) ─────────────────────────────

const TEMPLATE = `
<div class="sg-app" data-screen="welcome">
  <header class="sg-header">
    <div class="sg-brand">${ICON.mark}<span class="sg-brand-name">stretch<b>Goals</b></span></div>
    <div class="sg-header-tools" data-ref="headerTools">
      <span class="sg-status" data-ref="status" data-tone="good"><span class="sg-status-dot" aria-hidden="true"></span><span data-ref="statusText">Watching</span></span>
      <button type="button" class="sg-btn sg-btn-band" data-ref="pauseBtn">
        <span class="sg-btn-icon" data-ref="pauseIcon">${ICON.pause}</span><span data-ref="pauseLabel">Pause</span>
      </button>
      <button type="button" class="sg-btn sg-btn-band" data-ref="settingsBtn" aria-haspopup="dialog">
        ${ICON.sliders}<span>Settings</span>
      </button>
    </div>
  </header>

  <main class="sg-main" data-ref="main">
    <div class="sg-grid" data-ref="grid">

      <!-- 1. Welcome / camera permission -->
      <section class="sg-sheet sg-welcome" data-ref="welcome" aria-labelledby="sg-welcome-title">
        <h1 id="sg-welcome-title" class="sg-title">Meet Maizy.<br /><span class="sg-title-2">She slouches when you do.</span></h1>
        <p class="sg-lede">stretchGoals watches your posture through your camera, tells you what's off in plain words, and coaches you back with a quick stretch.</p>
        <div class="sg-welcome-body">
          <div class="sg-how">
            <h2 class="sg-h3">How it works</h2>
            <ol class="sg-steps">
              <li><span class="sg-step-dose">Camera on</span><span>Turn on your camera.</span></li>
              <li><span class="sg-step-dose">Hold 3 s</span><span>Sit up tall for 3 seconds. That becomes your good posture.</span></li>
              <li><span class="sg-step-dose">Then work</span><span>Get back to work. We only speak up when a problem lasts.</span></li>
            </ol>
          </div>
          <div class="sg-privacy">
            <h2 class="sg-h3">${ICON.lock} Your video stays on this laptop</h2>
            <p>Posture checks run right here. Video is never recorded or uploaded. Only the text of the coach's voice lines goes online.</p>
          </div>
        </div>
        <div class="sg-actions">
          <button type="button" class="sg-btn sg-btn-primary sg-btn-lg" data-ref="startBtn">Start camera</button>
          <span class="sg-note" data-ref="startNote">Your computer may ask for permission to use the camera.</span>
        </div>
        <div class="sg-alert" role="alert" data-ref="cameraError" hidden>
          <strong>We couldn't turn on your camera.</strong>
          <span data-ref="cameraErrorText"></span>
        </div>
      </section>

      <!-- Camera slot (Jordan). Never re-created. -->
      <figure class="sg-sheet sg-camera" data-ref="cameraCard" aria-label="Your camera">
        <div class="sg-camera-off" data-ref="cameraOff">${ICON.lens}<span>Camera is off</span></div>
        <video id="camera-video" autoplay muted playsinline></video>
        <canvas id="camera-overlay"></canvas>
        <span class="sg-viewfinder" aria-hidden="true"></span>
        <figcaption class="sg-chip" data-ref="cameraChip" hidden></figcaption>
      </figure>

      <!-- Maizy slot (Shawn). Never re-created. -->
      <div class="sg-sheet sg-maizy-card" data-ref="maizyCard">
        <span class="sg-height-rule" aria-hidden="true"></span>
        <div id="maizy"></div>
      </div>

      <!-- 2. Calibration -->
      <div class="sg-screen" data-for="calibrate">
        <section class="sg-sheet sg-side sg-calib-dial" data-ref="calibSide" aria-label="Calibration progress">
          <p class="sg-label">Calibration</p>
          <div class="sg-dial-wrap" data-ref="calibRing" data-tone="none" data-phase="idle">
            ${tickRing('calibTicks', 48)}
            <span class="sg-breath" aria-hidden="true"></span>
            <svg class="sg-dial-check" viewBox="0 0 24 24" aria-hidden="true">${CHECK_PATH}</svg>
            <span class="sg-dial-value" data-ref="calibValue">3</span>
          </div>
          <p class="sg-verdict" data-ref="calibVerdict">Ready when you are</p>
          <p class="sg-subverdict" data-ref="calibHint" aria-hidden="true">Breathe in, sit tall</p>
        </section>
        <section class="sg-sheet sg-panel sg-calib" data-ref="calibPanel" aria-labelledby="sg-calib-title">
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
        <section class="sg-sheet sg-side sg-scorecard" data-ref="scoreCard" data-tone="none" aria-label="Posture score">
          <p class="sg-label">Posture score</p>
          <div class="sg-score" aria-hidden="true">
            <span class="sg-score-digits" data-ref="scoreDigits">${digitColumn('digit100')}${digitColumn('digit10')}${digitColumn('digit1')}</span>
            <span class="sg-score-none" data-ref="scoreNone">--</span>
          </div>
          <span class="sg-visually-hidden" data-ref="scoreValue" aria-live="off"></span>
          <p class="sg-verdict" data-ref="verdict">Not calibrated yet</p>
          <p class="sg-subverdict" data-ref="subVerdict"></p>
          <p class="sg-recovered" data-ref="recovered" hidden><svg viewBox="0 0 24 24" aria-hidden="true">${CHECK_PATH}</svg><span data-ref="recoveredText"></span></p>
          <div class="sg-gauge" aria-hidden="true">
            ${scoreRuler()}
            <span class="sg-needle-rail" data-ref="needle"><span class="sg-needle"></span></span>
          </div>
        </section>

        <section class="sg-sheet sg-issues" data-ref="issuesCard" aria-labelledby="sg-issues-title">
          <div class="sg-card-head">
            <h2 id="sg-issues-title" class="sg-h3">What we're watching</h2>
            <span class="sg-count" data-ref="issueCount"></span>
          </div>
          <div class="sg-issues-body">
            <div class="sg-issues-main">
              <div class="sg-empty" data-ref="issuesEmpty">
                <p data-ref="issuesEmptyText"></p>
                <button type="button" class="sg-btn sg-btn-secondary" data-ref="issuesAction" hidden></button>
              </div>
              <ul class="sg-issue-list" data-ref="issueList"></ul>
            </div>
          </div>
        </section>

        <section class="sg-sheet sg-tip" data-ref="tipCard" aria-labelledby="sg-tip-title">
          <p class="sg-label" data-ref="tipLabel">Suggested stretch</p>
          <h2 id="sg-tip-title" class="sg-h2 sg-tip-name" data-ref="tipName"></h2>
          <p class="sg-tip-for" data-ref="tipFor"></p>
          <p class="sg-tip-how" data-ref="tipHow"></p>
          <ol class="sg-tip-steps" data-ref="tipStepList"></ol>
          <dl class="sg-dose">
            <div><dt>Hold</dt><dd data-ref="tipHold">-</dd></div>
            <div><dt>Steps</dt><dd data-ref="tipSteps">-</dd></div>
            <div><dt>Total</dt><dd data-ref="tipTime">-</dd></div>
          </dl>
          <div class="sg-tip-foot">
            <button type="button" class="sg-btn sg-btn-primary" data-ref="tipStart">Start</button>
          </div>
        </section>

        <section class="sg-sheet sg-session" data-ref="sessionCard" aria-label="This session">
          <dl class="sg-stats">
            <div><dt>Watched</dt><dd data-ref="watched">0:00</dd></div>
            <div><dt>Good posture</dt><dd data-ref="good">0%</dd></div>
            <div><dt>Best streak</dt><dd data-ref="streak">0:00</dd></div>
          </dl>
          <div class="sg-spark-wrap">
            <span class="sg-spark-label" data-ref="sparkLabel">Score, this session</span>
            <svg class="sg-spark" data-ref="spark" data-empty="true" viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label="Score over the last 5 minutes">
              <line class="sg-spark-grid" x1="0" x2="300" y1="${60 - 2 - (SCORE_GOOD / 100) * 56}" y2="${60 - 2 - (SCORE_GOOD / 100) * 56}" />
              <line class="sg-spark-grid" x1="0" x2="300" y1="${60 - 2 - (SCORE_OK / 100) * 56}" y2="${60 - 2 - (SCORE_OK / 100) * 56}" />
              <path class="sg-spark-area" data-ref="sparkArea" d="" />
              <path class="sg-spark-line" data-ref="sparkLine" d="" />
              <line class="sg-spark-cross" data-ref="sparkCross" x1="0" x2="0" y1="0" y2="60" />
              <circle class="sg-spark-dot" data-ref="sparkDot" cx="300" cy="30" r="3" />
            </svg>
            <span class="sg-spark-tip" data-ref="sparkTip" aria-hidden="true"></span>
            <span class="sg-spark-empty">Builds up while we watch</span>
          </div>
        </section>
      </div>

      <!-- 4. Guided stretch -->
      <div class="sg-screen" data-for="stretch">
        <section class="sg-sheet sg-side sg-countdown" data-ref="stretchSide" aria-label="Time left in this step">
          <p class="sg-label">This step</p>
          <div class="sg-dial-wrap" data-ref="stretchRing" data-tone="accent">
            ${tickRing('stretchTicks', 60)}
            <svg class="sg-dial-arc" viewBox="0 0 120 120" aria-hidden="true"><circle data-ref="stretchRingBar" cx="60" cy="60" r="41" pathLength="100" /></svg>
            <span class="sg-dial-value sg-dial-big" data-ref="stretchValue"></span>
          </div>
          <p class="sg-verdict" data-ref="stretchStepOf"></p>
          <ol class="sg-step-dots" data-ref="stepDots" aria-hidden="true"></ol>
        </section>
        <section class="sg-sheet sg-panel sg-guide" data-ref="stretchPanel" aria-labelledby="sg-guide-title">
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
    <span class="sg-footer-right">
      <span class="sg-keys" data-ref="keyHint" aria-hidden="true"><kbd>P</kbd> pause <kbd>S</kbd> settings</span>
      <span class="sg-footer-private">${ICON.lock} Video stays on this laptop</span>
    </span>
  </footer>

  <!-- 5. Settings (a sheet that slides in from the right) -->
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
      <div class="sg-range-wrap">
        <input type="range" id="sg-sensitivity" class="sg-range" min="0" max="1" step="0.05" data-ref="sensitivity" />
        <span class="sg-range-ticks" aria-hidden="true"></span>
      </div>
      <div class="sg-range-ends" aria-hidden="true"><span>Relaxed</span><span>Strict</span></div>
      <p class="sg-setting-desc">How far you can drift from your calibrated posture before we flag it.</p>
    </div>

    <div class="sg-setting">
      <div class="sg-setting-row">
        <label class="sg-setting-title" for="sg-overlay">Show skeleton on camera</label>
        <input type="checkbox" role="switch" id="sg-overlay" class="sg-switch" data-ref="overlayToggle" />
      </div>
      <p class="sg-setting-desc">Draws the points we measure (ears, shoulders) over your video.</p>
    </div>

    <div class="sg-setting" data-ref="cameraRow" hidden>
      <div class="sg-setting-row">
        <label class="sg-setting-title" for="sg-camera-pick">Camera</label>
        <select id="sg-camera-pick" class="sg-select" data-ref="cameraPick"></select>
      </div>
      <p class="sg-setting-desc sg-setting-error" data-ref="cameraPickError" role="alert" hidden></p>
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

    <div class="sg-setting sg-setting-keys">
      <span class="sg-setting-title">Keyboard</span>
      <dl class="sg-shortcuts">
        <div><dt><kbd>P</kbd></dt><dd>Pause or resume</dd></div>
        <div><dt><kbd>S</kbd> or <kbd>,</kbd></dt><dd>Open settings</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>Close settings</dd></div>
      </dl>
      <p class="sg-setting-desc">Session numbers stay in this window and reset when the app closes.</p>
    </div>
  </aside>
</div>`;

// ─── Screens ────────────────────────────────────────────────────────────────

// The cards each screen brings in, in the order they arrive (a stagger), and how each one
// arrives. Not one shared fade: each card enters the way its content reads. In animation
// terms: rise/settle/slide are fade + translate or scale entrances, unroll/wipe are clip-path
// reveals, and the camera and Maizy cards get a layout animation (FLIP) to their new spot.
const ENTRANCES = {
  welcome: [['welcome', 'rise', 0]],
  calibrate: [
    ['calibSide', 'settle', 0],
    ['calibPanel', 'rise', 70],
  ],
  dashboard: [
    ['scoreCard', 'settle', 0],
    ['issuesCard', 'unroll', 60],
    ['tipCard', 'slide', 140],
    ['sessionCard', 'fade', 220],
  ],
  stretch: [
    ['stretchSide', 'settle', 0],
    ['stretchPanel', 'wipe', 60],
  ],
};

const ARRIVALS = {
  rise: {
    keyframes: [
      { opacity: 0, transform: 'translateY(14px)' },
      { opacity: 1, transform: 'none' },
    ],
    duration: 360,
  },
  settle: {
    keyframes: [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'none' },
    ],
    duration: 380,
  },
  unroll: {
    keyframes: [
      { clipPath: 'inset(0 0 100% 0)' },
      { clipPath: 'inset(0 0 0 0)' },
    ],
    duration: 420,
  },
  slide: {
    keyframes: [
      { opacity: 0, transform: 'translateX(16px)' },
      { opacity: 1, transform: 'none' },
    ],
    duration: 400,
  },
  wipe: {
    keyframes: [
      { clipPath: 'inset(0 100% 0 0)' },
      { clipPath: 'inset(0 0 0 0)' },
    ],
    duration: 400,
  },
  fade: { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 320 },
};

function showScreen(name) {
  if (!root || !SCREENS.includes(name)) return;
  const changed = name !== screen;
  // The camera and Maizy keep playing across screens; FLIP them to their new spot
  const before = changed ? measure([refs.cameraCard, refs.maizyCard]) : null;
  screen = name;
  setData(root, 'screen', name);
  if (
    name === 'calibrate' &&
    calib.phase !== 'running' &&
    !lastState.calibrating
  ) {
    calib = { phase: 'idle', message: '' };
  }
  render();
  if (changed) {
    flip(before, { duration: 400, scale: true });
    for (const [ref, kind, delay] of ENTRANCES[name]) {
      const { keyframes, duration } = ARRIVALS[kind];
      play(refs[ref], keyframes, { duration, delay, easing: EASE_OUT });
    }
  }
}

/** Redraw the parts that depend on state, using the newest state we have. */
function render() {
  renderHeader();
  renderCamera(lastState);
  if (screen === 'calibrate') renderCalibration(lastState);
  if (screen === 'dashboard') renderDashboard(lastState);
  if (screen === 'stretch') renderStretch();
}

function renderHeader() {
  const onWelcome = screen === 'welcome';
  show(refs.headerTools, !onWelcome);
  show(refs.keyHint, !onWelcome);
  let text = 'Watching';
  let tone = 'good';
  if (paused) [text, tone] = ['Paused', 'off'];
  else if (
    screen === 'calibrate' &&
    (calib.phase === 'running' || lastState.calibrating)
  )
    [text, tone] = ['Calibrating', 'accent'];
  else if (screen === 'stretch') [text, tone] = ['Stretching', 'accent'];
  setText(refs.statusText, text);
  setData(refs.status, 'tone', tone);
  // Pause button: icon + label
  const label = paused ? 'Resume' : 'Pause';
  if (refs.pauseLabel.textContent !== label) {
    refs.pauseLabel.textContent = label;
    refs.pauseIcon.innerHTML = paused ? ICON.play : ICON.pause;
    refs.settingsPause.textContent = label;
    refs.settingsPauseDesc.textContent = paused
      ? 'Paused. Posture checks are off until you resume.'
      : 'Stops posture checks until you resume.';
  }
}

function renderCamera(state) {
  let chip = '';
  if (paused) chip = 'Paused';
  else if (refs.cameraOff.hidden && !state.present) chip = "We can't see you";
  setText(refs.cameraChip, chip);
  show(refs.cameraChip, chip !== '');
}

// ─── 1. Welcome: start the camera ───────────────────────────────────────────

async function onStartClick() {
  show(refs.cameraError, false);
  if (!services.camera?.startCamera) {
    // No camera module yet (e.g. in a playground): just move on.
    showScreen('calibrate');
    return;
  }
  refs.startBtn.disabled = true;
  setText(refs.startBtn, 'Starting camera…');
  try {
    await services.camera.startCamera(refs.video, refs.canvas);
    applyOverlay(); // the camera module may only draw once it has started
    refreshCameraList();
    showScreen('calibrate');
  } catch (err) {
    console.error('[ui] startCamera failed:', err);
    setText(refs.cameraErrorText, cameraErrorMessage(err));
    show(refs.cameraError, true);
    play(
      refs.cameraError,
      [
        { opacity: 0, transform: 'translateY(-6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 260, easing: EASE_OUT },
    );
    refs.cameraError.scrollIntoView({ block: 'nearest' });
    setText(refs.startBtn, 'Try again');
  } finally {
    refs.startBtn.disabled = false;
    if (screen !== 'welcome') setText(refs.startBtn, 'Start camera');
  }
}

/** Turn a getUserMedia error into a sentence a person can act on. */
function cameraErrorMessage(err) {
  const name = err?.name ?? '';
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  const isMac = /mac/i.test(platform);
  const isWindows = /win/i.test(platform);
  const windowsHelp =
    'open Settings → Privacy & security → Camera and turn on camera access, including “Let desktop apps access your camera”';
  const macHelp =
    'open System Settings → Privacy & Security → Camera and allow stretchGoals';

  if (
    ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)
  ) {
    if (isWindows)
      return `Camera access is blocked. To fix it, ${windowsHelp}, then try again.`;
    if (isMac)
      return `Camera access is blocked. To fix it, ${macHelp}, then try again.`;
    return `Camera access is blocked. On Windows, ${windowsHelp}. On a Mac, ${macHelp}.`;
  }
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) {
    return 'Your camera seems busy. Close other apps that might be using it, like Zoom or Teams, then try again.';
  }
  if (
    ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(
      name,
    )
  ) {
    return "We couldn't find a camera. Check that one is plugged in and turned on, then try again.";
  }
  return isWindows
    ? `Something went wrong starting the camera. Close other apps that use it, like Zoom, or ${windowsHelp}.`
    : 'Something went wrong starting the camera. Close other apps that might be using it, like Zoom, then try again.';
}

// ─── 2. Calibration ─────────────────────────────────────────────────────────

const CALIBRATION_REASONS = {
  no_person:
    "We couldn't see you. Sit where the camera can see your head and both shoulders.",
  low_visibility:
    "We couldn't see your ears and shoulders clearly. Try more light in front of you.",
  moved:
    'You moved a bit during calibration. Sit still for the 3 seconds and try again.',
  no_frames:
    'No camera frames arrived. Check that the camera is on and not paused.',
  cancelled: 'Calibration was cancelled.',
};

async function onCalibrateClick() {
  if (calib.phase === 'running') return;
  if (paused) setPaused(false); // calibration needs frames
  if (!services.posture?.startCalibration) {
    calib = {
      phase: 'failed',
      message:
        "The posture module isn't connected yet, so there's nothing to calibrate. You can skip for now.",
    };
    renderCalibration(lastState);
    return;
  }
  calib = { phase: 'running', message: '' };
  ownCalibration = true;
  render();
  let result;
  try {
    result = await services.posture.startCalibration(CALIBRATION_MS);
  } catch (err) {
    console.error('[ui] startCalibration failed:', err);
    result = { ok: false };
  } finally {
    ownCalibration = false;
  }
  if (result?.ok) {
    calibrationSucceeded();
  } else {
    const message =
      result?.message ??
      CALIBRATION_REASONS[result?.reason] ??
      "Calibration didn't finish. Please try again.";
    calib = { phase: 'failed', message };
    render();
  }
}

function calibrationSucceeded() {
  calib = { phase: 'done', message: '' };
  render();
  // Let the check draw itself for a moment, then go to the dashboard
  setTimeout(() => {
    if (screen === 'calibrate' && calib.phase === 'done')
      showScreen('dashboard');
  }, 1200);
}

let litTicks = -1; // how many calibration ticks are lit (only touch the DOM when it changes)

function renderCalibration(state) {
  const running = calib.phase === 'running' || state.calibrating;
  let value = '3';
  let verdict = 'Ready when you are';
  let hint = 'Breathe in, sit tall';
  let message = "We'll remember this as your good posture.";
  let tone = 'none';
  let fraction = 0;
  let button = 'Calibrate';
  let phase = calib.phase;

  if (running) {
    phase = 'running';
    fraction = clamp01(state.calibrationProgress);
    tone = 'accent';
    // 3, 2, 1 as the ring fills
    value = String(
      Math.max(1, Math.ceil((1 - fraction) * (CALIBRATION_MS / 1000))),
    );
    verdict = 'Hold still…';
    hint = `${Math.round(fraction * 100)}% captured`;
    message = 'Nice and tall. Keep still until the ring fills.';
    button = 'Calibrating…';
  } else if (calib.phase === 'done') {
    fraction = 1;
    value = '';
    tone = 'good';
    verdict = 'Got it';
    hint = 'Saved as your good posture';
    message = "That's your good posture. Taking you to your dashboard…";
  } else if (calib.phase === 'failed') {
    tone = 'bad';
    value = '!';
    verdict = "Let's try again";
    hint = 'Nothing was saved';
    message = calib.message;
    button = 'Try again';
  }

  // Light the dial's ticks up to the progress
  const lit = Math.round(fraction * 48);
  if (lit !== litTicks) {
    litTicks = lit;
    refs.calibTicks
      .querySelectorAll('.sg-tick')
      .forEach((t, i) => t.classList.toggle('is-on', i < lit));
  }
  setData(refs.calibRing, 'tone', tone);
  setData(refs.calibRing, 'phase', phase);
  if (refs.calibValue.textContent !== value) {
    refs.calibValue.textContent = value;
    if (running)
      play(
        refs.calibValue,
        [
          { opacity: 0, transform: 'scale(1.25)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 280, easing: EASE_OUT },
      );
  }
  setText(refs.calibVerdict, verdict);
  setText(refs.calibHint, hint);
  setText(refs.calibMessage, message);
  setData(
    refs.calibMessage,
    'tone',
    calib.phase === 'failed' && !running ? 'bad' : '',
  );
  setText(refs.calibBtn, button);
  refs.calibBtn.disabled = running || calib.phase === 'done';
}

// ─── 3. Dashboard ───────────────────────────────────────────────────────────

/** Which situation are we in? Decides the score, the messages and the empty states. */
function dashboardMode(state) {
  if (paused) return 'paused';
  if (!state.present) return 'absent';
  if (!state.calibrated) return 'uncalibrated';
  if (state.score == null) return 'unreadable';
  return 'live';
}

const MODE_TEXT = {
  paused: [
    'Paused',
    'Resume to keep watching.',
    'Paused. Resume when you want us to keep an eye on your posture.',
  ],
  absent: [
    "We can't see you",
    "Move into the camera's view.",
    "We can't see you right now. Sit where the camera can see your head and both shoulders.",
  ],
  uncalibrated: [
    'Not calibrated yet',
    'Calibrate to get a score.',
    'Calibrate first, so we know what your good posture looks like.',
  ],
  unreadable: [
    "Can't read your posture",
    'Keep both shoulders in view.',
    'We can see you, but not well enough to measure. Keep your head and both shoulders in view.',
  ],
};

// The score glides to its new value; the digits and the needle follow the glide.
let scoreGlide = null;
let shownDigits = '';

function showScoreDigits(value) {
  const n = Math.round(Math.min(100, Math.max(0, value)));
  const key = String(n);
  if (key === shownDigits) return;
  shownDigits = key;
  const digits = [Math.floor(n / 100), Math.floor(n / 10) % 10, n % 10];
  // Column i shows digit d by sliding its 0–9 strip up d tenths of its height
  ['digit100', 'digit10', 'digit1'].forEach((ref, i) => {
    refs[ref].firstChild.style.transform = `translateY(${-digits[i] * 10}%)`;
  });
  show(refs.digit100, n === 100);
  show(refs.digit10, n >= 10);
}

function renderDashboard(state) {
  const mode = dashboardMode(state);
  const issues =
    mode === 'live' ? (state.issues ?? []).filter((i) => ISSUES[i.id]) : [];
  // Worst issue = highest severity (posture sorts worst first, but this is cheap insurance)
  const worst = issues.reduce(
    (a, b) => (b.severity > (a?.severity ?? -1) ? b : a),
    null,
  );

  // Score: digits, needle and tone
  const live = mode === 'live';
  show(refs.scoreDigits, live);
  show(refs.scoreNone, !live);
  if (live) {
    const score = Math.round(state.score);
    const tone = scoreTone(score);
    setText(refs.scoreValue, `Score ${score} out of 100`);
    setData(refs.scoreCard, 'tone', tone);
    scoreGlide.to(score);
    setText(
      refs.verdict,
      tone === 'good'
        ? 'Looking good'
        : tone === 'ok'
          ? 'A little off'
          : 'Time to reset',
    );
    setText(
      refs.subVerdict,
      worst
        ? (worst.layman ?? ISSUES[worst.id].layman)
        : 'Right where you calibrated.',
    );
  } else {
    setText(refs.scoreValue, 'No score');
    setData(refs.scoreCard, 'tone', 'none');
    scoreGlide.to(0);
    setText(refs.verdict, MODE_TEXT[mode][0]);
    setText(refs.subVerdict, MODE_TEXT[mode][1]);
  }

  renderIssues(mode, issues, state.metrics?.severity);
  renderTip(worst);
  session.track(state, mode, live ? scoreTone(state.score) : 'none');
}

function makeIssueRow(id) {
  const li = document.createElement('li');
  li.className = 'sg-issue';
  li.dataset.state = 'fine';
  li.dataset.issue = id;
  li.innerHTML = `
    <div class="sg-issue-names">
      <span class="sg-issue-title"><span class="sg-hl" aria-hidden="true"></span><span class="sg-issue-title-text"></span></span>
      <span class="sg-issue-plain"></span>
    </div>
    <div class="sg-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-label="Severity"><span class="sg-bar-fill"></span></div>
    <div class="sg-issue-meta">
      <span class="sg-pill" hidden>Sustained${PEN_RING}</span>
      <span class="sg-issue-time"></span>
      <svg class="sg-issue-check" viewBox="0 0 24 24" aria-hidden="true">${CHECK_PATH}</svg>
    </div>`;
  const row = {
    li,
    title: li.querySelector('.sg-issue-title-text'),
    plain: li.querySelector('.sg-issue-plain'),
    bar: li.querySelector('.sg-bar'),
    fill: li.querySelector('.sg-bar-fill'),
    pill: li.querySelector('.sg-pill'),
    time: li.querySelector('.sg-issue-time'),
    severity: '',
  };
  // Names don't change, so set them once. medical is null for too_close.
  const info = ISSUES[id];
  row.title.textContent = info.medical ?? info.layman;
  row.plain.textContent = info.medical ? info.layman : '';
  row.plain.hidden = !info.medical;
  return row;
}

// Issues that were sustained and then fixed get a short "Recovered" moment
const RECOVERED_MS = 4000;
const recoveredUntil = {}; // issue id -> time the moment ends
let wasSustained = new Set();
let recoveredTimer = 0;

function noteRecoveries(live, byId) {
  if (!live) {
    wasSustained = new Set();
    return;
  }
  const now = performance.now();
  for (const id of wasSustained) {
    if (!byId[id]) {
      recoveredUntil[id] = now + RECOVERED_MS;
      setText(
        refs.recoveredText,
        `Recovered: ${ISSUES[id].layman.toLowerCase()}`,
      );
      show(refs.recovered, true);
      clearTimeout(recoveredTimer);
      recoveredTimer = setTimeout(
        () => show(refs.recovered, false),
        RECOVERED_MS,
      );
    }
  }
  wasSustained = new Set(
    Object.values(byId)
      .filter((i) => i.sustained)
      .map((i) => i.id),
  );
}

/**
 * All five posture checks are always listed. Issues detected right now (state.issues)
 * go to the top, worst first, in colour. The others say "Fine" and show a grey bar
 * from metrics.severity, so you can watch a problem build before it's flagged.
 */
function renderIssues(mode, issues, severities) {
  const live = mode === 'live';
  setText(
    refs.issueCount,
    !live ? '' : issues.length ? `${issues.length} to fix` : 'All clear',
  );

  // Not live (paused, nobody there, not calibrated...): one message in the card's frame
  show(refs.issuesEmpty, !live);
  show(refs.issueList, live);
  const byId = Object.fromEntries(issues.map((i) => [i.id, i]));
  noteRecoveries(live, byId);
  if (!live) {
    const action =
      mode === 'uncalibrated' ? 'Calibrate' : mode === 'paused' ? 'Resume' : '';
    setText(refs.issuesEmptyText, MODE_TEXT[mode][2]);
    setText(refs.issuesAction, action);
    show(refs.issuesAction, action !== '');
    return;
  }

  const now = performance.now();
  const states = {};
  for (const id of ISSUE_IDS) {
    const row = issueRows[id];
    const issue = byId[id];
    const severity = clamp01(issue ? issue.severity : severities?.[id]);

    const sevKey = severity.toFixed(2);
    if (row.severity !== sevKey) {
      row.severity = sevKey;
      row.fill.style.transform = `scaleX(${sevKey})`;
      row.bar.setAttribute('aria-valuenow', Math.round(severity * 100));
    }
    const recovered = !issue && recoveredUntil[id] > now;
    states[id] = !issue
      ? recovered
        ? 'recovered'
        : 'fine'
      : issue.sustained
        ? 'sustained'
        : 'active';
    setData(row.li, 'state', states[id]);
    show(row.pill, Boolean(issue?.sustained));
    setText(
      row.time,
      issue
        ? `for ${duration(issue.durationSec)}`
        : recovered
          ? 'Recovered'
          : 'Fine',
    );
  }

  // Order: current issues (worst first), then the rest. Only move rows when the order changes,
  // and slide them to their new places so a row never jumps without you seeing where it went.
  const order = [
    ...issues.map((i) => i.id),
    ...ISSUE_IDS.filter((id) => !byId[id]),
  ];
  const key = order.join(',');
  if (key !== issueOrder) {
    const first = issueOrder === '';
    issueOrder = key;
    const before = measure(order.map((id) => issueRows[id].li));
    for (const id of order) refs.issueList.appendChild(issueRows[id].li);
    if (!first) flip(before, { duration: 360 });
  }
}

let tipAnimatedAt = 0;

function renderTip(worstIssue) {
  const issueId = worstIssue?.id ?? null;
  const key = issueId ?? 'none';
  if (suggested?.key === key) return; // nothing changed
  const changed = suggested !== null;
  const stretch = stretchFor(issueId);
  suggested = { key, stretch };

  setText(refs.tipLabel, issueId ? 'Suggested stretch' : 'Quick reset');
  setText(refs.tipName, stretchName(stretch));
  refs.tipName.title = stretchName(stretch); // the full name, if it's cut to two lines
  setText(
    refs.tipFor,
    issueId
      ? `For: ${ISSUES[issueId].layman.toLowerCase()}`
      : "Good any time you've been sitting a while.",
  );
  setText(refs.tipHow, stretchHow(stretch));
  const seconds = stretchSeconds(stretch);
  const steps = Array.isArray(stretch.steps) ? stretch.steps : [];
  const hold = Math.max(0, ...steps.map((s) => Number(s?.seconds) || 0));
  setText(refs.tipTime, seconds ? `${seconds} s` : '-');
  setText(refs.tipSteps, steps.length ? String(steps.length) : '-');
  setText(refs.tipHold, hold ? `${hold} s` : '-');
  // The whole routine, when the slip is tall enough to show it (ui.css hides it otherwise)
  refs.tipStepList.replaceChildren(
    ...steps.map((step) => {
      const li = document.createElement('li');
      const seconds = Number(step?.seconds) || 0;
      li.innerHTML = `<span></span><span class="sg-tip-step-s">${seconds ? `${seconds} s` : ''}</span>`;
      li.firstChild.textContent = stepText(step);
      return li;
    }),
  );
  // A new prescription: the slip slides in from the side, like a new sheet on the pad.
  // At most every 1.5 s, so two issues trading places can't make it flicker.
  const now = performance.now();
  if (changed && screen === 'dashboard' && now - tipAnimatedAt > 1500) {
    tipAnimatedAt = now;
    play(
      refs.tipCard,
      [
        { opacity: 0.2, transform: 'translateX(10px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 320, easing: EASE_OUT },
    );
  }
}

// ─── 4. Guided stretch ──────────────────────────────────────────────────────

function onStartStretchClick() {
  const stretch = suggested?.stretch;
  if (!stretch?.id) return;
  const firstSeconds = Number(stretch.steps?.[0]?.seconds) || 0;
  stretchRun = {
    id: stretch.id,
    stretch,
    stepIndex: 0,
    secondsLeft: firstSeconds,
    stepTotal: firstSeconds,
  };
  showScreen('stretch');
  safeCall(stretches?.startStretch, stretch.id);
}

function onStopStretchClick() {
  stretchRun = null;
  safeCall(stretches?.stopStretch);
  showScreen('dashboard');
}

/** Joseph's stretch events: { type: "start" | "step" | "tick" | "end", stretchId, stepIndex, secondsLeft } */
function onStretchEvent(event) {
  if (!event || !root) return;
  if (event.type === 'end') {
    stretchRun = null;
    if (screen === 'stretch') showScreen('dashboard');
    return;
  }
  if (!stretchRun || stretchRun.id !== event.stretchId) {
    const stretch = findStretch(event.stretchId);
    stretchRun = {
      id: event.stretchId,
      stretch,
      stepIndex: -1,
      secondsLeft: 0,
      stepTotal: 0,
    };
  }
  const stepIndex = Number(event.stepIndex) || 0;
  const secondsLeft = Math.max(0, Number(event.secondsLeft) || 0);
  if (
    event.type === 'start' ||
    event.type === 'step' ||
    stepIndex !== stretchRun.stepIndex
  ) {
    // New step: its full length is in the data, or else the first countdown number we see
    stretchRun.stepTotal =
      Number(stretchRun.stretch.steps?.[stepIndex]?.seconds) || secondsLeft;
  }
  stretchRun.stepIndex = stepIndex;
  stretchRun.secondsLeft = secondsLeft;
  stretchRun.stepTotal = Math.max(stretchRun.stepTotal, secondsLeft);

  if (screen !== 'stretch') showScreen('stretch');
  else renderStretch();
}

let shownStep = null; // "stretchId:stepIndex" on screen, so a new step can cross-fade in

function renderStretch() {
  if (!stretchRun) return;
  const { stretch, stepIndex, secondsLeft, stepTotal } = stretchRun;
  const steps = Array.isArray(stretch.steps) ? stretch.steps : [];
  setText(refs.stretchName, stretchName(stretch));

  const stepKey = `${stretchRun.id}:${stepIndex}`;
  if (stepKey !== shownStep) {
    const isNew = shownStep !== null;
    shownStep = stepKey;
    setText(
      refs.stretchStep,
      stepText(steps[stepIndex]) || 'Follow the steps with the voice.',
    );
    const next = stepText(steps[stepIndex + 1]);
    setText(
      refs.stretchNext,
      steps.length
        ? next
          ? `Up next: ${next}`
          : 'Last step. Nearly done.'
        : '',
    );
    renderStepDots(steps.length, stepIndex);
    // Blur bridges the old and new sentence, so it reads as one change, not two
    if (isNew)
      play(
        refs.stretchStep,
        [
          { opacity: 0, filter: 'blur(4px)', transform: 'translateY(6px)' },
          { opacity: 1, filter: 'blur(0)', transform: 'none' },
        ],
        { duration: 360, easing: EASE_OUT },
      );
  }
  setText(
    refs.stretchStepOf,
    steps.length ? `Step ${stepIndex + 1} of ${steps.length}` : '',
  );
  const value = secondsLeft ? `${secondsLeft}` : '';
  if (refs.stretchValue.textContent !== value) {
    refs.stretchValue.textContent = value;
    play(
      refs.stretchValue,
      [
        { opacity: 0.3, transform: 'translateY(-14%)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 240, easing: EASE_OUT },
    );
  }
  setData(refs.stretchRing, 'tone', 'accent');
  setRing(refs.stretchRingBar, stepTotal ? secondsLeft / stepTotal : 0);
}

/** One dot per step: done, now, to come. Rebuilt only when the step changes. */
function renderStepDots(count, current) {
  refs.stepDots.innerHTML = Array.from(
    { length: count },
    (_, i) =>
      `<li data-state="${i < current ? 'done' : i === current ? 'now' : 'next'}"></li>`,
  ).join('');
}

// ─── 5. Settings ────────────────────────────────────────────────────────────

let lastFocus = null;
let closeTimer = 0;

/** viaKeyboard: shortcuts open it instantly (no animation on something you do many times a day). */
function openSettings(viaKeyboard = false) {
  if (!refs.settings.hidden && !refs.settings.inert) return;
  clearTimeout(closeTimer);
  lastFocus = document.activeElement;
  setData(refs.settings, 'instant', viaKeyboard === true ? 'true' : 'false');
  show(refs.scrim, true);
  show(refs.settings, true);
  refs.settings.inert = false;
  // Next frame: flip to open, so the CSS transition (a spring) runs from the closed position
  requestAnimationFrame(() => {
    setData(refs.settings, 'open', 'true');
    setData(refs.scrim, 'open', 'true');
  });
  // `inert` stops Tab from wandering behind the panel
  refs.main.inert = true;
  refs.headerTools.inert = true;
  refs.settingsClose.focus();
  refreshCameraList();
}

function closeSettings() {
  if (refs.settings.hidden || refs.settings.inert) return;
  // Inert at once (Maizy and Tab can't reach it), hidden once it has slid away
  refs.settings.inert = true;
  setData(refs.settings, 'open', 'false');
  setData(refs.scrim, 'open', 'false');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(
    () => {
      show(refs.scrim, false);
      show(refs.settings, false);
    },
    reducedMotion() || refs.settings.dataset.instant === 'true' ? 0 : 240,
  );
  refs.main.inert = false;
  refs.headerTools.inert = false;
  lastFocus?.focus?.();
}

function applyVoice() {
  refs.voiceToggle.checked = settings.voiceOn;
  safeCall(services.voice?.voiceCoach?.setMuted, !settings.voiceOn);
}

function applyOverlay() {
  refs.overlayToggle.checked = settings.overlayOn;
  safeCall(services.camera?.setOverlayVisible, settings.overlayOn);
}

/** Fill the camera picker. Hidden unless the camera module can list 2 or more cameras. */
async function refreshCameraList() {
  let cameras = [];
  try {
    cameras = (await services.camera?.listCameras?.()) ?? [];
  } catch (err) {
    console.error('[ui] listCameras failed:', err);
  }
  const usable = Array.isArray(cameras)
    ? cameras.filter((c) => c?.deviceId)
    : [];
  show(refs.cameraRow, usable.length >= 2);
  if (usable.length < 2) return;
  const current = safeCall(services.camera?.currentCameraId);
  refs.cameraPick.replaceChildren(
    ...usable.map((c, i) => {
      const option = document.createElement('option');
      option.value = c.deviceId;
      option.textContent = c.label || `Camera ${i + 1}`;
      option.selected = c.deviceId === current;
      return option;
    }),
  );
}

async function onCameraPick() {
  show(refs.cameraPickError, false);
  refs.cameraPick.disabled = true;
  try {
    await services.camera?.switchCamera?.(refs.cameraPick.value);
  } catch (err) {
    console.error('[ui] switchCamera failed:', err);
    setText(
      refs.cameraPickError,
      safeCall(services.camera?.describeCameraError, err) ??
        cameraErrorMessage(err),
    );
    show(refs.cameraPickError, true);
  } finally {
    refs.cameraPick.disabled = false;
    refreshCameraList();
  }
}

function applySensitivity() {
  refs.sensitivity.value = String(settings.sensitivity);
  const s = settings.sensitivity;
  setText(
    refs.sensitivityValue,
    s < 0.34 ? 'Relaxed' : s > 0.66 ? 'Strict' : 'Balanced',
  );
  refs.sensitivity.style.setProperty('--fill', `${(s * 100).toFixed(0)}%`);
  safeCall(services.posture?.setSensitivity, settings.sensitivity);
}

function onRecalibrateClick() {
  safeCall(services.posture?.resetCalibration);
  closeSettings();
  calib = { phase: 'idle', message: '' };
  if (paused) setPaused(false);
  showScreen('calibrate');
}

/** P pauses, S or comma opens settings, Esc closes them. Ignored while typing or with modifiers. */
function onKeydown(e) {
  if (e.key === 'Escape') {
    closeSettings();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || screen === 'welcome')
    return;
  if (e.target?.closest?.('input[type=text], textarea, [contenteditable]'))
    return;
  const key = e.key.toLowerCase();
  if (key === 'p' && refs.settings.hidden) setPaused(!paused);
  else if ((key === 's' || key === ',') && refs.settings.hidden) {
    e.preventDefault();
    openSettings(true);
  }
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
  if (document.querySelector('link[data-sg-ui]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./ui.css', import.meta.url).href;
  link.dataset.sgUi = '';
  document.head.appendChild(link);
}

/**
 * Archivo (SIL Open Font License, see ./fonts/OFL.txt), shipped with the app so it works
 * offline. Loaded with FontFace so Vite bundles the files; until it arrives the system font shows.
 */
function addFonts() {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  const faces = [
    [
      new URL('./fonts/archivo-latin-standard-normal.woff2', import.meta.url)
        .href,
      'normal',
    ],
    [
      new URL('./fonts/archivo-latin-standard-italic.woff2', import.meta.url)
        .href,
      'italic',
    ],
  ];
  for (const [url, style] of faces) {
    const face = new FontFace('SG Archivo', `url(${url}) format("woff2")`, {
      weight: '100 900',
      stretch: '62% 125%',
      style,
      display: 'swap',
    });
    document.fonts.add(face);
    face
      .load()
      .catch((err) =>
        console.warn('[ui] font failed to load, using the system font:', err),
      );
  }
}

function mount(el, givenServices = {}) {
  if (root) {
    console.warn('[ui] ui.mount() was called twice; ignoring the second call.');
    return;
  }
  addStylesheet();
  addFonts();
  services = givenServices ?? {};
  stretches = services.stretches ?? createFallbackStretches();

  // Safety net: if nobody gave `el` a height (it's empty, so it measures 0), fill the window.
  if (el.getBoundingClientRect().height < 1) el.style.height = '100vh';

  el.classList.add('sg-host');
  el.innerHTML = TEMPLATE;
  root = el.querySelector('.sg-app');
  root
    .querySelectorAll('[data-ref]')
    .forEach((node) => (refs[node.dataset.ref] = node));
  refs.video = root.querySelector('#camera-video');
  refs.canvas = root.querySelector('#camera-overlay');

  // The settings sheet slides on a spring (damping 0.8, response 0.3)
  const spring = springEasing(0.8, 0.3);
  root.style.setProperty('--sg-spring', spring.easing);
  root.style.setProperty('--sg-spring-ms', `${spring.ms}ms`);

  // Issue rows: made once, shown/hidden by update()
  for (const id of ISSUE_IDS) {
    issueRows[id] = makeIssueRow(id);
    refs.issueList.appendChild(issueRows[id].li);
  }
  session = createSession(refs, setText);

  // The score's digits and needle follow one gliding value
  scoreGlide = glide(0, (value) => {
    showScoreDigits(value);
    refs.needle.style.transform = `translateX(${value.toFixed(2)}%)`;
  });
  showScoreDigits(0); // the glide only calls back when it moves

  // "Camera is off" sits behind the video until frames arrive
  refs.video.addEventListener('playing', () => {
    show(refs.cameraOff, false);
    renderCamera(lastState);
  });
  refs.video.addEventListener('emptied', () => show(refs.cameraOff, true));

  // Buttons
  refs.startBtn.addEventListener('click', onStartClick);
  refs.calibBtn.addEventListener('click', onCalibrateClick);
  refs.skipBtn.addEventListener('click', () => showScreen('dashboard'));
  refs.tipStart.addEventListener('click', onStartStretchClick);
  refs.stopBtn.addEventListener('click', onStopStretchClick);
  refs.issuesAction.addEventListener('click', () => {
    if (paused) setPaused(false);
    else showScreen('calibrate');
  });
  refs.pauseBtn.addEventListener('click', () => setPaused(!paused));
  refs.settingsPause.addEventListener('click', () => setPaused(!paused));
  refs.settingsBtn.addEventListener('click', () => openSettings(false));
  refs.settingsClose.addEventListener('click', closeSettings);
  refs.scrim.addEventListener('click', closeSettings);
  root.addEventListener('keydown', onKeydown);
  // Shortcuts also work when nothing inside the app has focus yet
  document.addEventListener('keydown', (e) => {
    if (!root.contains(e.target)) onKeydown(e);
  });
  refs.recalibrateBtn.addEventListener('click', onRecalibrateClick);
  refs.voiceToggle.addEventListener('change', () => {
    settings.voiceOn = refs.voiceToggle.checked;
    saveSettings();
    applyVoice();
  });
  refs.overlayToggle.addEventListener('change', () => {
    settings.overlayOn = refs.overlayToggle.checked;
    saveSettings();
    applyOverlay();
  });
  refs.cameraPick.addEventListener('change', onCameraPick);
  refs.sensitivity.addEventListener('input', () => {
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
  applyOverlay();

  screen = ''; // so the first showScreen counts as a change and plays the welcome entrance
  showScreen('welcome');
}

function update(state) {
  if (!root || !state) return;
  lastState = state;

  // A calibration just started. If our Calibrate button didn't start it (e.g. the tray did),
  // jump to the calibration screen so the person sees the ring.
  if (state.calibrating && !wasCalibrating) {
    externalCalibration = !ownCalibration;
    if (externalCalibration) {
      calib = { phase: 'running', message: '' };
      if (screen !== 'calibrate') showScreen('calibrate');
    }
  }
  // That outside calibration finished. We never see its result, so read it from the state.
  // (Our own button's result is handled in onCalibrateClick.)
  if (!state.calibrating && wasCalibrating && externalCalibration) {
    externalCalibration = false;
    if (screen === 'calibrate') {
      if (state.calibrated) calibrationSucceeded();
      else
        calib = {
          phase: 'failed',
          message: "Calibration didn't finish. Sit tall and try again.",
        };
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
