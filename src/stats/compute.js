// Turns the saved daily log into the numbers the stats page shows.
// Pure (no DOM, no storage), so it runs in Node too: node src/stats/try-compute.mjs

/**
 * One saved day.
 * @typedef {Object} DayLog
 * @property {number} monitoredSec  seconds someone was in frame with a live score
 * @property {number} goodSec       of those, seconds with a good score
 * @property {number} scoreSum      total of every score sample, for the average
 * @property {number} scoreSamples  how many score samples were added up
 * @property {number} stretches     stretches finished that day
 */

/**
 * One bar of the 7-day trend.
 * @typedef {Object} DayPoint
 * @property {string} date        "YYYY-MM-DD"
 * @property {string} label       short weekday, e.g. "Mon"
 * @property {boolean} isToday
 * @property {number|null} avgScore  0–100, or null if nothing was monitored that day
 * @property {number} minutes     minutes monitored
 * @property {number} stretches
 */

/**
 * @typedef {Object} Stats
 * @property {{ avgScore: number|null, goodPct: number|null, minutes: number, stretches: number }} today
 * @property {DayPoint[]} week        oldest first, always 7 days ending today
 * @property {number|null} weekAvg    average score over the last 7 days
 * @property {number|null} weekDelta  weekAvg minus the 7 days before; null if either week has no data
 * @property {{ current: number, best: number, stretchedToday: boolean, atRisk: boolean }} streak
 */

/** "YYYY-MM-DD" for the computer's local date (not UTC, so late evenings count as today). */
export function dayKey(time) {
  const d = new Date(time);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** The day key `offset` days away from `time` (-1 = yesterday). Noon, so summer time never skips a day. */
function shiftDay(time, offset) {
  const d = new Date(time);
  return dayKey(
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12),
  );
}

function weekdayLabel(time, offset) {
  const d = new Date(time);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12);
  return day.toLocaleDateString(undefined, { weekday: 'short' });
}

/** Average score over some days, weighted by how many samples each day has. */
function averageScore(dayLogs) {
  let sum = 0;
  let samples = 0;
  for (const log of dayLogs) {
    sum += log.scoreSum;
    samples += log.scoreSamples;
  }
  return samples > 0 ? sum / samples : null;
}

/** Days in a row with at least one stretch. A streak that ended yesterday is still alive today. */
function streakFrom(days, now) {
  const stretched = (key) => (days[key]?.stretches ?? 0) > 0;
  const stretchedToday = stretched(dayKey(now));

  let current = 0;
  for (
    let offset = stretchedToday ? 0 : -1;
    stretched(shiftDay(now, offset));
    offset--
  )
    current++;

  // Best: the longest run anywhere in the saved days
  const keys = Object.keys(days).filter(stretched).sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const key of keys) {
    run =
      previous !== null && shiftDay(new Date(`${previous}T12:00`), 1) === key
        ? run + 1
        : 1;
    best = Math.max(best, run);
    previous = key;
  }

  return {
    current,
    best,
    stretchedToday,
    atRisk: current > 0 && !stretchedToday,
  };
}

/**
 * Everything the stats page needs, from the saved days.
 * @param {Record<string, DayLog>} days  keyed by "YYYY-MM-DD"
 * @param {number} [now]
 * @returns {Stats}
 */
export function computeStats(days, now = Date.now()) {
  const todayLog = days[dayKey(now)];

  const week = [];
  for (let offset = -6; offset <= 0; offset++) {
    const key = shiftDay(now, offset);
    const log = days[key];
    week.push({
      date: key,
      label: weekdayLabel(now, offset),
      isToday: offset === 0,
      avgScore: log ? averageScore([log]) : null,
      minutes: log ? log.monitoredSec / 60 : 0,
      stretches: log?.stretches ?? 0,
    });
  }

  const logsBetween = (from, to) => {
    const logs = [];
    for (let offset = from; offset <= to; offset++) {
      const log = days[shiftDay(now, offset)];
      if (log) logs.push(log);
    }
    return logs;
  };
  const weekAvg = averageScore(logsBetween(-6, 0));
  const previousAvg = averageScore(logsBetween(-13, -7));

  return {
    today: {
      avgScore: todayLog ? averageScore([todayLog]) : null,
      goodPct:
        todayLog?.monitoredSec > 0
          ? (100 * todayLog.goodSec) / todayLog.monitoredSec
          : null,
      minutes: todayLog ? todayLog.monitoredSec / 60 : 0,
      stretches: todayLog?.stretches ?? 0,
    },
    week,
    weekAvg,
    weekDelta:
      weekAvg !== null && previousAvg !== null ? weekAvg - previousAvg : null,
    streak: streakFrom(days, now),
  };
}
