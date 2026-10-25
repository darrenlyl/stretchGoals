// Desktop notifications for posture issues (Track 4, Job 7).
// Rule: notify about a sustained issue only when you're not looking at the app (window hidden,
// minimised or behind other apps). While you're looking at it, Maizy and the voice handle it.
// Cooldowns match Joseph's voice coach, so nobody gets nagged.
// Sent through voice.notify, so the coach reads each one aloud (and skips its own nudge meanwhile).
import { ISSUES } from './shared/contracts.js';
import { notify } from './voice/index.js';

const SAME_ISSUE_MS = 10_000; // wait 10 seconds before notifying about the same issue again
const ANY_NOTIFY_MS = 60_000; // and at least 60 seconds between any two notifications

// One short fix per issue, shown under the issue name
const TIPS = {
  forward_head: 'Tuck your chin back so your ears sit over your shoulders.',
  slouching: 'Sit back in your chair and lift your chest.',
  head_tilt: 'Level your head and relax your neck.',
  uneven_shoulders: 'Let both shoulders drop and relax.',
  too_close: 'Lean back a little from the screen.',
};

let paused = false;
let sustainedBefore = new Set();
const lastAlertAt = {}; // issue id -> when it was last notified (or seen in the app)
let lastNotifyAt = -Infinity;

// True when the app window isn't what you're looking at.
function lookingAway() {
  return document.visibilityState === 'hidden' || !document.hasFocus();
}

// Call with every PostureState (~10 times a second).
function update(state, now = Date.now()) {
  const issues = state?.issues ?? [];
  const sustained = issues.filter((issue) => issue.sustained);
  const sustainedNow = new Set(sustained.map((issue) => issue.id));
  const away = lookingAway();

  // An issue that became sustained while you were looking was already shown by Maizy and the voice,
  // so it counts as alerted: no notification right after you hide the window.
  for (const id of sustainedNow) {
    if (!sustainedBefore.has(id) && !away) lastAlertAt[id] = now;
  }
  sustainedBefore = sustainedNow;

  if (paused || !away || !state?.present || state.calibrating) return;
  if (now - lastNotifyAt < ANY_NOTIFY_MS) return;

  // Issues come worst first; take the worst one we haven't alerted about recently.
  const issue = sustained.find((i) => now - (lastAlertAt[i.id] ?? -Infinity) >= SAME_ISSUE_MS);
  if (!issue) return;

  const names = ISSUES[issue.id];
  const title = names.medical ?? names.layman;
  const body = names.medical ? `${names.layman}. ${TIPS[issue.id]}` : TIPS[issue.id];
  notify(title, body);
  lastAlertAt[issue.id] = now;
  lastNotifyAt = now;
}

// Tray Pause/Resume: no notifications while paused.
function setPaused(value) {
  paused = Boolean(value);
}

export const postureNotifier = { update, setPaused };
