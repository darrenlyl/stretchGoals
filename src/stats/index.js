// Stats: a small daily log of posture and stretches, and the stats page that shows it.
// Saved in localStorage on this computer only. Numbers only: no video, no landmarks.
//
// API:
//   recordPosture(state)        call with every real PostureState (~10 a second)
//   recordStretchEvent(event)   call with every stretch event (onStretchEvent)
//   getStats(now?)              today, the last 7 days and the streak (see compute.js)
//   clearStats()                forget everything (for testing)
//   mountStatsPage(el)          build the stats page inside el (see page.js)
import { computeStats, dayKey } from './compute.js';
import { createStatsPage } from './page.js';

const STORAGE_KEY = 'stretchGoals.stats.v1';
const GOOD_SCORE = 80; // same line the UI uses for "green"
const MAX_GAP_SEC = 2; // a longer gap between samples (paused, camera off) isn't monitoring time
const MIN_STRETCH_SEC = 20; // a stretch counts as done if you stuck with it this long
const SAVE_EVERY_MS = 15000; // write to localStorage at most this often while sampling
const KEEP_DAYS = 60; // older days are dropped

let days = null; // { "YYYY-MM-DD": DayLog }, loaded on first use
let lastSampleAt = null; // Date.now() of the previous posture sample
let lastSavedAt = 0;
let unsaved = false; // true when there are counted seconds that aren't in localStorage yet
let stretchStartedAt = null; // Date.now() when the current stretch started

/**
 * Adds one PostureState to today's log. Only counts time when someone is in frame,
 * calibrated, and has a score.
 * @param {import('../shared/contracts.js').PostureState} state
 * @param {number} [now] for testing; normally the current time
 */
export function recordPosture(state, now = Date.now()) {
  const gapSec = lastSampleAt === null ? 0 : (now - lastSampleAt) / 1000;
  lastSampleAt = now;

  const live =
    state.present && state.calibrated && typeof state.score === 'number';
  if (!live) return;

  const seconds = Math.min(Math.max(gapSec, 0), MAX_GAP_SEC);
  const today = todayLog(now);
  today.monitoredSec += seconds;
  if (state.score >= GOOD_SCORE) today.goodSec += seconds;
  today.scoreSum += state.score;
  today.scoreSamples += 1;
  // Time spent in each bad habit (issue IDs from contracts.js), for the habit breakdown
  today.issueSec ??= {}; // days saved before this was added don't have it
  for (const issue of state.issues ?? []) {
    today.issueSec[issue.id] = (today.issueSec[issue.id] ?? 0) + seconds;
  }
  unsaved = true;

  if (now - lastSavedAt >= SAVE_EVERY_MS) save(now);
}

/**
 * Counts finished stretches. The stretches module sends "end" both when a stretch finishes
 * and when it's stopped early, so a stretch only counts if it lasted MIN_STRETCH_SEC.
 * A rep stretch (ui.onRepStretchEvent) sends completed: true when every rep was done: that always counts.
 * @param {import('../shared/contracts.js').StretchEvent} event
 * @param {number} [now] for testing; normally the current time
 */
export function recordStretchEvent(event, now = Date.now()) {
  if (event.type === 'start') stretchStartedAt = now;
  if (event.type !== 'end' || stretchStartedAt === null) return;

  const lastedSec = (now - stretchStartedAt) / 1000;
  stretchStartedAt = null;
  if (lastedSec < MIN_STRETCH_SEC && !event.completed) return; // every rep done counts, however quick

  todayLog(now).stretches += 1;
  save(now);
}

/** Today's numbers, the last 7 days and the streak. */
export function getStats(now = Date.now()) {
  return computeStats(loadDays(), now);
}

/**
 * Builds the stats page inside `el` and keeps it up to date.
 * @param {HTMLElement} el
 * @param {{ getStats?: () => import('./compute.js').Stats }} [options] the dev page passes fake stats here
 * @returns {{ refresh: () => void, unmount: () => void }}
 */
export function mountStatsPage(el, options = {}) {
  return createStatsPage(el, {
    getStats: options.getStats ?? (() => getStats()),
  });
}

/** Forget all saved stats. */
export function clearStats() {
  days = {};
  lastSampleAt = null;
  stretchStartedAt = null;
  save(Date.now());
}

function todayLog(now) {
  const all = loadDays();
  const key = dayKey(now);
  all[key] ??= {
    monitoredSec: 0,
    goodSec: 0,
    scoreSum: 0,
    scoreSamples: 0,
    stretches: 0,
  };
  return all[key];
}

// localStorage can be missing or throw (private mode, blocked); stats then last this run only.
function loadDays() {
  if (days) return days;
  try {
    days = JSON.parse(localStorage.getItem(STORAGE_KEY))?.days ?? {};
  } catch {
    days = {};
  }
  return days;
}

function save(now) {
  lastSavedAt = now;
  unsaved = false;
  const oldest = dayKey(now - KEEP_DAYS * 86400000);
  for (const key of Object.keys(loadDays())) if (key < oldest) delete days[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ days }));
  } catch {
    // not saved: the numbers still show until the app closes
  }
}

// Closing or reloading the window: save what's been counted since the last save.
// Only if something new was counted, so an old copy never overwrites newer saved stats.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (unsaved) save(Date.now());
  });
}
