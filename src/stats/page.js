// The stats page: today's summary, the streak, the last 7 days, and your most common habits.
// Builds its own HTML inside the element it's given. Classes start with "st-" so they can't
// clash with the UI's "sg-" classes, and colours come from the UI's --sg-* tokens, so it
// matches the light and dark themes when it sits inside the app.
import './stats.css';
import { ISSUES } from '../shared/contracts.js';

const GOOD_SCORE = 80; // green from here, same as the UI
const OK_SCORE = 50; // yellow from here, red below
const REFRESH_MS = 5000; // how often the page re-reads the numbers while it's open

const TEMPLATE = `
<div class="st-page">
  <section class="st-card st-today" aria-labelledby="st-today-title">
    <h2 id="st-today-title" class="st-title">Today</h2>
    <div class="st-tiles">
      <div class="st-tile">
        <p class="st-label">Average score</p>
        <p class="st-big" data-st="todayScore" data-tone="none">–</p>
      </div>
      <div class="st-tile">
        <p class="st-label">Good posture</p>
        <p class="st-big" data-st="todayGood">–</p>
      </div>
      <div class="st-tile">
        <p class="st-label">Time watched</p>
        <p class="st-big" data-st="todayTime">0 min</p>
      </div>
      <div class="st-tile">
        <p class="st-label">Stretches</p>
        <p class="st-big" data-st="todayStretches">0</p>
      </div>
    </div>
    <p class="st-note" data-st="todayNote"></p>
  </section>

  <section class="st-card st-streak" aria-labelledby="st-streak-title">
    <h2 id="st-streak-title" class="st-title">Stretch streak</h2>
    <p class="st-streak-number"><span data-st="streakNumber">0</span> <span class="st-streak-unit" data-st="streakUnit">days</span></p>
    <p class="st-streak-message" data-st="streakMessage"></p>
    <p class="st-note" data-st="streakBest"></p>
  </section>

  <section class="st-card st-week" aria-labelledby="st-week-title">
    <div class="st-week-head">
      <h2 id="st-week-title" class="st-title">Last 7 days</h2>
      <p class="st-week-summary"><span data-st="weekAvg">–</span> <span class="st-delta" data-st="weekDelta" data-tone="none"></span></p>
    </div>
    <ol class="st-bars" data-st="bars"></ol>
    <p class="st-note">Bars show your average posture score each day. Empty days had no camera time.</p>
  </section>

  <section class="st-card st-habits" aria-labelledby="st-habits-title">
    <div class="st-week-head">
      <h2 id="st-habits-title" class="st-title">Your posture habits</h2>
      <p class="st-week-summary" data-st="topHabit"></p>
    </div>
    <ul class="st-habit-list" data-st="habitList"></ul>
    <p class="st-note" data-st="habitNote"></p>
  </section>
</div>`;

/**
 * @param {HTMLElement} el
 * @param {{ getStats: () => import('./compute.js').Stats }} options
 */
export function createStatsPage(el, { getStats }) {
  el.innerHTML = TEMPLATE;
  const refs = {};
  for (const node of el.querySelectorAll('[data-st]'))
    refs[node.dataset.st] = node;

  function refresh() {
    render(refs, getStats());
  }

  refresh();
  // Only re-read while the page is actually on screen (it's hidden on other screens).
  const onScreen = () => el.offsetParent !== null;
  const timer = setInterval(() => {
    if (onScreen()) refresh();
  }, REFRESH_MS);
  // Opening the Stats screen changes the page's size from 0 to something, so refresh right away
  const sizeWatcher = new ResizeObserver(() => {
    if (onScreen()) refresh();
  });
  sizeWatcher.observe(el);

  return {
    refresh,
    unmount() {
      clearInterval(timer);
      sizeWatcher.disconnect();
      el.innerHTML = '';
    },
  };
}

function render(refs, stats) {
  const { today, week, weekAvg, weekDelta, streak, habits } = stats;

  // Today
  refs.todayScore.textContent =
    today.avgScore === null ? '–' : Math.round(today.avgScore);
  refs.todayScore.dataset.tone = tone(today.avgScore);
  refs.todayGood.textContent =
    today.goodPct === null ? '–' : `${Math.round(today.goodPct)}%`;
  refs.todayTime.textContent = formatMinutes(today.minutes);
  refs.todayStretches.textContent = today.stretches;
  refs.todayNote.textContent =
    today.avgScore === null
      ? 'No posture data yet today. Turn the camera on and calibrate to start counting.'
      : '"Good posture" is time with a score of 80 or more.';

  // Streak
  refs.streakNumber.textContent = streak.current;
  refs.streakUnit.textContent = streak.current === 1 ? 'day' : 'days';
  refs.streakMessage.textContent = streakMessage(streak);
  refs.streakBest.textContent =
    streak.best > 0
      ? `Best streak: ${streak.best} ${streak.best === 1 ? 'day' : 'days'}`
      : '';

  // Last 7 days
  refs.weekAvg.textContent =
    weekAvg === null ? 'No data yet' : `Average ${Math.round(weekAvg)}`;
  if (weekDelta === null) {
    refs.weekDelta.textContent = '';
    refs.weekDelta.dataset.tone = 'none';
  } else {
    const rounded = Math.round(weekDelta);
    refs.weekDelta.textContent = `${rounded > 0 ? '+' : ''}${rounded} vs last week`;
    refs.weekDelta.dataset.tone =
      rounded > 0 ? 'good' : rounded < 0 ? 'bad' : 'none';
  }
  refs.bars.replaceChildren(...week.map(bar));

  // Habits: the most common one, then every one as a share of all bad-posture time
  const top = habits[0];
  refs.topHabit.textContent = top
    ? `Most common: ${ISSUES[top.id]?.medical ?? ISSUES[top.id]?.layman ?? top.id}`
    : '';
  refs.habitList.replaceChildren(...habits.map(habitRow));
  refs.habitNote.textContent = top
    ? 'Last 7 days. Each bar is that habit’s share of all the time your posture was off.'
    : 'No bad posture spotted in the last 7 days yet. Keep it up, or turn the camera on to start counting.';
}

// One habit: both names, a bar as long as its share, and the share and time
function habitRow(habit) {
  const names = ISSUES[habit.id] ?? { medical: null, layman: habit.id };
  const share = Math.round(habit.share);

  const item = document.createElement('li');
  item.className = 'st-habit';

  const text = document.createElement('div');
  text.className = 'st-habit-text';
  const main = document.createElement('span');
  main.className = 'st-habit-name';
  main.textContent = names.medical ?? names.layman; // "too close" has no medical name
  const plain = document.createElement('span');
  plain.className = 'st-habit-plain';
  plain.textContent = names.medical ? names.layman : '';
  text.append(main, plain);

  const track = document.createElement('span');
  track.className = 'st-habit-track';
  const fill = document.createElement('span');
  fill.className = 'st-habit-fill';
  fill.style.width = `${Math.max(share, 2)}%`; // a tiny share still shows a sliver
  track.append(fill);

  const amount = document.createElement('span');
  amount.className = 'st-habit-amount';
  amount.textContent = `${share}% · ${formatMinutes(habit.minutes)}`;

  item.append(text, track, amount);
  return item;
}

// One day in the chart: the score on top, a bar as tall as the score, the weekday underneath.
function bar(day) {
  const item = document.createElement('li');
  item.className = 'st-bar';
  if (day.isToday) item.classList.add('st-bar-today');

  const value = day.avgScore === null ? null : Math.round(day.avgScore);
  item.setAttribute(
    'aria-label',
    `${day.isToday ? 'Today' : day.label}: ${value ?? 'no data'}`,
  );

  const score = document.createElement('span');
  score.className = 'st-bar-value';
  score.textContent = value ?? '';

  const track = document.createElement('span');
  track.className = 'st-bar-track';
  const fill = document.createElement('span');
  fill.className = 'st-bar-fill';
  fill.dataset.tone = tone(day.avgScore);
  fill.style.height = value === null ? '0%' : `${Math.max(value, 4)}%`; // a tiny score still shows a sliver
  track.append(fill);

  const label = document.createElement('span');
  label.className = 'st-bar-label';
  label.textContent = day.isToday ? 'Today' : day.label;

  item.append(score, track, label);
  return item;
}

function tone(score) {
  if (score === null) return 'none';
  if (score >= GOOD_SCORE) return 'good';
  if (score >= OK_SCORE) return 'ok';
  return 'bad';
}

function streakMessage({ current, stretchedToday, atRisk }) {
  if (stretchedToday) return 'You stretched today. Nice work!';
  if (atRisk)
    return `Do a stretch today to keep your ${current}-day streak going.`;
  return 'Finish a stretch to start a streak.';
}

/** 12 → "12 min", 75 → "1 h 15 min", 0.2 → "<1 min" */
function formatMinutes(minutes) {
  const total = Math.round(minutes); // 59.9 seconds reads as "1 min", not "0 min"
  if (total === 0 && minutes > 0) return '<1 min'; // some time, but under half a minute
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
