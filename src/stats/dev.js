// Test page for src/stats. Shows the stats page with fake history, or with the real saved
// stats, and can feed fake posture and stretches through the real recorder.
import {
  mountStatsPage,
  getStats,
  recordPosture,
  recordStretchEvent,
  clearStats,
} from './index.js';
import { computeStats, dayKey } from './compute.js';

const DAY_MS = 86400000;
const ref = (name) => document.querySelector(`[data-ref="${name}"]`);
const devRoot = document.querySelector('.st-dev');
const status = ref('status');

let source = 'fakeWeeks';
const page = mountStatsPage(ref('page'), { getStats: () => statsFor(source) });

for (const button of document.querySelectorAll('[data-source]')) {
  button.addEventListener('click', () => {
    source = button.dataset.source;
    showSource();
  });
}

ref('themeButton').addEventListener('click', () => {
  const dark = devRoot.dataset.theme !== 'dark';
  devRoot.dataset.theme = dark ? 'dark' : 'light';
  ref('themeButton').textContent = dark ? 'Light theme' : 'Dark theme';
});

// 600 PostureStates, 0.1 s apart, like 1 minute of the camera at 10 a second
ref('sitButton').addEventListener('click', () => {
  const start = Date.now() - 60000;
  for (let i = 0; i < 600; i++) {
    const score = 60 + Math.round(30 * Math.sin(i / 60)); // drifts between 30 and 90
    // a low score comes with forward head, a very low one with slouching too
    const issues = [];
    if (score < 70) issues.push({ id: 'forward_head' });
    if (score < 45) issues.push({ id: 'slouching' });
    recordPosture(
      { present: true, calibrated: true, score, issues },
      start + i * 100,
    );
  }
  source = 'real';
  showSource('Added 1 minute of sitting to the real saved stats.');
});

// a "start" then an "end" 30 seconds later, like a finished stretch
ref('stretchButton').addEventListener('click', () => {
  const end = Date.now();
  const event = { stretchId: 'chin_tuck', stepIndex: 0, secondsLeft: 0 };
  recordStretchEvent({ ...event, type: 'start' }, end - 30000);
  recordStretchEvent({ ...event, type: 'end' }, end);
  source = 'real';
  showSource('Added a finished stretch to the real saved stats.');
});

ref('clearButton').addEventListener('click', () => {
  clearStats();
  source = 'real';
  showSource('Cleared the real saved stats.');
});

showSource();

function showSource(message = '') {
  for (const button of document.querySelectorAll('[data-source]')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.source === source),
    );
  }
  status.textContent = message;
  page.refresh();
}

function statsFor(name) {
  if (name === 'real') return getStats();
  if (name === 'empty') return computeStats({});
  if (name === 'fakeFirstDay') return computeStats(fakeDays([[0, 74, 25, 1]]));
  // two weeks with a gap, getting better, and a 4-day stretch streak up to today
  return computeStats(
    fakeDays([
      [-13, 58, 90, 0],
      [-12, 61, 120, 1],
      [-11, 55, 60, 0],
      [-9, 64, 150, 1],
      [-8, 60, 80, 0],
      [-7, 66, 110, 1],
      [-6, 63, 95, 0],
      [-5, 70, 140, 1],
      [-4, 72, 160, 0],
      [-3, 78, 130, 1],
      [-2, 81, 170, 2],
      [-1, 84, 120, 1],
      [0, 79, 45, 1],
    ]),
  );
}

/** [daysAgo, averageScore, minutesWatched, stretches] → saved-day objects like the recorder makes */
function fakeDays(rows) {
  const days = {};
  for (const [offset, score, minutes, stretches] of rows) {
    const samples = minutes * 600; // 10 a second
    const badSec = minutes * 60 * Math.min(Math.max((90 - score) / 40, 0), 1); // worse score, more bad time
    days[dayKey(Date.now() + offset * DAY_MS)] = {
      monitoredSec: minutes * 60,
      goodSec: minutes * 60 * Math.min(Math.max((score - 50) / 40, 0), 1), // better score, more good time
      scoreSum: score * samples,
      scoreSamples: samples,
      stretches,
      // the bad time split between habits, forward head the most common
      issueSec: {
        forward_head: badSec * 0.45,
        slouching: badSec * 0.3,
        head_tilt: badSec * 0.15,
        too_close: badSec * 0.07,
        uneven_shoulders: badSec * 0.03,
      },
    };
  }
  return days;
}
