// Quick check of the stats maths, no browser needed:  node src/stats/try-compute.mjs
import { computeStats, dayKey } from './compute.js';

const DAY_MS = 86400000;
const now = Date.now();
const day = (offset, score, minutes, stretches) => [
  dayKey(now + offset * DAY_MS),
  {
    monitoredSec: minutes * 60,
    goodSec: (minutes * 60) / 2,
    scoreSum: score * minutes * 600,
    scoreSamples: minutes * 600,
    stretches,
  },
];

const check = (name, actual, expected) =>
  console.log(
    `${actual === expected ? 'ok  ' : 'FAIL'} ${name}: ${actual} (expected ${expected})`,
  );

// Last week averages 60, this week 80; stretched today and the 2 days before; a 4-day run 10 days ago
const days = Object.fromEntries([
  day(-12, 60, 60, 1),
  day(-11, 60, 60, 1),
  day(-10, 60, 60, 1),
  day(-9, 60, 60, 1),
  day(-2, 80, 60, 1),
  day(-1, 80, 60, 1),
  day(0, 80, 30, 1),
]);
const stats = computeStats(days, now);

check('today average', Math.round(stats.today.avgScore), 80);
check('today good %', Math.round(stats.today.goodPct), 50);
check('today minutes', stats.today.minutes, 30);
check('week has 7 days', stats.week.length, 7);
check('last bar is today', stats.week[6].isToday, true);
check('empty day has no score', stats.week[0].avgScore, null);
check('week average', Math.round(stats.weekAvg), 80);
check('change vs last week', Math.round(stats.weekDelta), 20);
check('current streak', stats.streak.current, 3);
check('best streak', stats.streak.best, 4);
check('stretched today', stats.streak.stretchedToday, true);

// Streak still alive if you haven't stretched YET today
const notYet = computeStats(
  { ...days, [dayKey(now)]: { ...days[dayKey(now)], stretches: 0 } },
  now,
);
check('streak kept until today ends', notYet.streak.current, 2);
check('streak at risk', notYet.streak.atRisk, true);

// Nothing saved at all
const empty = computeStats({}, now);
check('no data: today average', empty.today.avgScore, null);
check('no data: week delta', empty.weekDelta, null);
check('no data: streak', empty.streak.current, 0);
