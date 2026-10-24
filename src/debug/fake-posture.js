// Fake posture panel: sliders that send fake PostureStates, so others can test without a camera.
// Usage: const stop = mountFakePosturePanel(el, (state) => { ... });
import { ISSUES, ISSUE_IDS } from '../shared/contracts.js';

// Send a state 10 times a second, like the real camera.
const TICK_MS = 100;

// Draws the panel in el and calls onState(state) on every change. Returns stop().
export function mountFakePosturePanel(el, onState) {
  el.innerHTML = '';
  el.append(makeStyle());

  const panel = make('div', { className: 'fake-posture' });
  panel.append(make('h3', { textContent: 'Fake posture panel' }));

  // Top controls
  const present = checkbox('Person in frame', true);
  const calibrated = checkbox('Calibrated', true);
  const calibrating = checkbox('Calibrating now', false);
  const calibrationProgress = slider('Calibration progress', 0, 1, 0.01, 0);
  const autoScore = checkbox('Score follows issues', true);
  const score = slider('Score', 0, 100, 1, 100);
  panel.append(
    row(present.label, calibrated.label, calibrating.label),
    row(calibrationProgress.label),
    row(autoScore.label, score.label),
  );

  // One row per issue
  const issueControls = {};
  for (const id of ISSUE_IDS) {
    const active = checkbox('active', false);
    const severity = slider('severity', 0, 1, 0.01, 0.5);
    const sustained = checkbox('sustained', false);
    const name = make('span', { className: 'issue-name', textContent: id });
    panel.append(row(name, active.label, severity.label, sustained.label));
    // startedAt is used to count durationSec
    issueControls[id] = { active, severity, sustained, startedAt: null };
  }

  el.append(panel);

  // Read the controls into a PostureState
  function buildState() {
    const now = performance.now();
    const isPresent = present.input.checked;

    const issues = [];
    const severityById = {};
    for (const id of ISSUE_IDS) {
      const c = issueControls[id];
      const on = isPresent && c.active.input.checked;
      if (on && c.startedAt === null) c.startedAt = now;
      if (!on) c.startedAt = null;

      const sev = on ? Number(c.severity.input.value) : 0;
      severityById[id] = sev;
      if (on) {
        issues.push({
          id,
          medical: ISSUES[id].medical,
          layman: ISSUES[id].layman,
          severity: sev,
          durationSec: (now - c.startedAt) / 1000,
          sustained: c.sustained.input.checked,
        });
      }
    }
    issues.sort((a, b) => b.severity - a.severity); // worst first

    if (autoScore.input.checked) {
      const total = Object.values(severityById).reduce((sum, s) => sum + s, 0);
      score.input.value = Math.round(100 * (1 - Math.min(1, total * 0.5)));
    }
    score.input.disabled = autoScore.input.checked;
    score.show();
    calibrationProgress.show();
    for (const id of ISSUE_IDS) issueControls[id].severity.show();

    const hasScore = isPresent && calibrated.input.checked;
    return {
      timestamp: now,
      present: isPresent,
      calibrated: calibrated.input.checked,
      calibrating: calibrating.input.checked,
      calibrationProgress: Number(calibrationProgress.input.value),
      score: hasScore ? Number(score.input.value) : null,
      issues,
      metrics: {
        severity: severityById,
        headForward: severityById.forward_head,
        slouch: severityById.slouching,
        // Fake angles for Ossie
        headTiltDeg: isPresent ? severityById.head_tilt * 20 : null,
        shoulderTiltDeg: isPresent ? severityById.uneven_shoulders * 10 : null,
        closeness: isPresent ? 1 + severityById.too_close * 0.4 : null,
        shoulderDrop: isPresent ? severityById.slouching * 0.08 : null,
        headSource: isPresent ? 'ears' : null,
        raw: {},
      },
    };
  }

  // Send now, on every change, and on a timer
  const emit = () => onState(buildState());
  panel.addEventListener('input', emit);
  const timer = setInterval(emit, TICK_MS);
  emit();

  return function stop() {
    clearInterval(timer);
    panel.removeEventListener('input', emit);
    el.innerHTML = '';
  };
}

// --- HTML helpers ---

function make(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

function row(...children) {
  const div = make('div', { className: 'row' });
  div.append(...children);
  return div;
}

function checkbox(text, checked) {
  const input = make('input', { type: 'checkbox', checked });
  const label = make('label');
  label.append(input, ` ${text}`);
  return { input, label };
}

// Slider with its value shown next to it. show() refreshes the number.
function slider(text, min, max, step, value) {
  const input = make('input', { type: 'range', min, max, step, value });
  const valueText = make('span', { className: 'value' });
  const label = make('label');
  label.append(`${text} `, input, valueText);
  const show = () => (valueText.textContent = ` ${input.value}`);
  show();
  return { input, label, show };
}

function makeStyle() {
  return make('style', {
    textContent: `
      .fake-posture { font: 13px system-ui, sans-serif; border: 2px dashed #e0a000;
        background: #fffbea; color: #222; padding: 8px 12px; border-radius: 8px; max-width: 640px; }
      .fake-posture h3 { margin: 0 0 6px; font-size: 14px; }
      .fake-posture .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin: 4px 0; }
      .fake-posture .issue-name { width: 130px; font-family: ui-monospace, monospace; }
      .fake-posture .value { display: inline-block; width: 3em; font-family: ui-monospace, monospace; }
      .fake-posture input[type=range] { width: 120px; vertical-align: middle; }
    `,
  });
}
