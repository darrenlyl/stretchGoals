import { computeMetrics } from "./metrics.js";
import { computeSeverities, computeScore } from "./severity.js";
import { ISSUES } from "../shared/contracts.js";
import { calibrate } from "./calibration.js";

let baseline = null;
let calib = null;
let sensitivity = 0.5;

export function setSensitivity(value){
    sensitivity = value;
}

export function startCalibration(ms = 3000){
    return new Promise((resolve) => {
        calib = { frames: [], startTs: null, ms, resolve };
    });
}

export function resetCalibration(){
    baseline = null;
    if (calib){
        calib.resolve({ ok: false, reason: "cancelled", message: "Calibration was cancelled."});
        calib = null;
    }
}
export function analyze(frame) {
  // --- Calibration in progress: collect frames, report progress ---
  if (calib) {
    if (calib.startTs === null) calib.startTs = frame.timestamp; // first frame starts the clock
    calib.frames.push(frame);
    const elapsed = frame.timestamp - calib.startTs;

    if (elapsed >= calib.ms) {
      // 3 seconds are up: build the baseline (or find out why we can't)
      const result = calibrate(calib.frames);
      if (result.ok) baseline = result.baseline;
      calib.resolve(result); // tells whoever is waiting (the UI) the result
      calib = null;          // calibration is over
    } else {
      // Still collecting: no score yet, just progress for the UI's ring
      return {
        timestamp: frame.timestamp,
        present: frame.landmarks !== null,
        calibrated: baseline !== null,
        calibrating: true,
        calibrationProgress: elapsed / calib.ms,
        score: null,
        issues: [],
        metrics: {},
      };
    }
  }

  const present = frame.landmarks !== null;
  const m = computeMetrics(frame);

  // Can't judge yet: nobody there, can't see shoulders, or no baseline
  if (!m || !baseline) {
    return {
      timestamp: frame.timestamp,
      present,
      calibrated: baseline !== null,
      calibrating: false,
      calibrationProgress: 0,
      score: null,
      issues: [],
      metrics: {},
    };
  }

  const severity = computeSeverities(m, baseline, 1.5 - sensitivity);
  const score = computeScore(severity);
  const issues = [];

  for (const id in severity){
    if (severity[id] > 0.3){
        issues.push({
            id: id, 
            medical: ISSUES[id].medical,
            layman: ISSUES[id].layman,
            severity: severity[id],
            durationSec: 0,
            sustained: false,
        });
    }
  }

  return {
    timestamp: frame.timestamp,
    present,
    calibrated: true,
    calibrating: false,
    calibrationProgress: 0,
    score,
    issues,
    metrics: { ...m, severity },
  };
}