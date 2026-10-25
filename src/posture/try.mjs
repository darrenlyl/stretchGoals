import { makeFakeFrame } from "./fake-frames.js";
console.log("upright ear:", makeFakeFrame().landmarks[7]);
console.log("dropped ear:", makeFakeFrame({ neckDrop: 0.2 }).landmarks[7]);

import { computeMetrics } from "./metrics.js";
console.log("upright:", computeMetrics(makeFakeFrame()));
console.log("dropped:", computeMetrics(makeFakeFrame({ neckDrop: 0.2 })));

const noEars = makeFakeFrame();
noEars.landmarks[7].visibility = 0.2;
console.log("ears hidden:", computeMetrics(noEars));

const noShoulder = makeFakeFrame();
noShoulder.landmarks[11].visibility = 0.2;
console.log("shoulder hidden:", computeMetrics(noShoulder));

import { median } from "./calibration.js";
console.log(median([0.87, 0.88, 0.86, 0.87, 0.20]));  
console.log(median([4, 1, 3, 2]));                

import { computeBaseline } from "./calibration.js";
const samples = [
  computeMetrics(makeFakeFrame()),
  computeMetrics(makeFakeFrame()),
  computeMetrics(makeFakeFrame({ neckDrop: 0.6 })),   // glitchy frame
];
console.log("baseline:", computeBaseline(samples));

import { calibrate } from "./calibration.js";
const upright = Array.from({ length: 30 }, () => makeFakeFrame());
const empty = Array.from({ length: 30 }, () => ({ timestamp: 0, width: 640, height: 480, landmarks: null }));
console.log("upright:", calibrate(upright).ok);
console.log("empty:", calibrate(empty).reason);
console.log("too few:", calibrate(upright.slice(0, 3)).reason);

import { computeSeverities } from "./severity.js";
const base = calibrate(upright).baseline;
console.log("sev upright:", computeSeverities(computeMetrics(makeFakeFrame()), base));
console.log("sev head down:", computeSeverities(computeMetrics(makeFakeFrame({ neckDrop: 0.2 })), base));

import { analyze, startCalibration } from "./index.js";
console.log("before calibrating:", analyze(makeFakeFrame()).score);
const done = startCalibration(3000);
for (let t = 0; t <= 3000; t += 100) {
  const frame = makeFakeFrame();
  frame.timestamp = t;
  const s = analyze(frame);
  if (t % 1000 === 0) console.log("t =", t, "calibrating:", s.calibrating, "progress:", s.calibrationProgress);
}
console.log("result ok:", (await done).ok);
console.log("upright:", analyze(makeFakeFrame()).score);
console.log("head down:", analyze(makeFakeFrame({ neckDrop: 0.2 })).score);