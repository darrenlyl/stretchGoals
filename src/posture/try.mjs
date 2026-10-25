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