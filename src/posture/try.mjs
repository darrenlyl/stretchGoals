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