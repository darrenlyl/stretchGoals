import { computeMetrics } from "./metrics.js";
import { computeSeverities, computeScore } from "./severity.js";
import { ISSUES } from "../shared/contracts.js";
import { calibrate } from "./calibration.js";

let baseline = null;
let calib = null;
let sensitivity = 0.5;
let startedAt = {};    // issue id → when it switched ON
let belowSince = {};   // issue id → when it dropped below 0.15 (the "turning off" countdown)
let smooth = null;     // the smoothed metrics; null = start fresh
const ALPHA = 0.2;     // how far each new frame pulls the smoothed value: 0.2 = 20%

function smoothMetrics(m){
    if(smooth === null){
        smooth = { ...m };
        return smooth;
    }
    for (const key in m){
        smooth[key] = ALPHA * m[key] + (1 - ALPHA) * smooth[key];
    }
    return smooth;
}

// Forget every issue (after recalibrating, old issues were judged against the old baseline)
function clearIssues() {
  startedAt = {};
  belowSince = {};
  smooth = null;
}

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
    clearIssues();
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
      if (result.ok) {
        baseline = result.baseline;
        clearIssues();
      }
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
    smooth = null;   // start fresh when they're measurable again
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

  const sm = smoothMetrics(m);   // calm the camera jitter before judging
  // How much drift we allow: strict (1) = 1×, balanced (0.5) = 1.5×, relaxed (0) = 2.25×
  const severity = computeSeverities(sm, baseline, 1.5 ** (2 - 2 * sensitivity));
  const score = computeScore(severity);
  const issues = [];

  for (const id in severity) {
    const sev = severity[id];
    const active = startedAt[id] !== undefined;   // is this issue currently ON?

    // OFF → ON: crossed the 0.3 line
    if (!active && sev > 0.3) {
      startedAt[id] = frame.timestamp;
    }

    // ON → maybe OFF: only after 2 s below 0.15
    if (active) {
      if (sev < 0.15) {
        if (belowSince[id] === undefined) belowSince[id] = frame.timestamp;   // start the countdown
        if (frame.timestamp - belowSince[id] >= 2000) {                       // 2 s passed
          delete startedAt[id];                                               // switch OFF
          delete belowSince[id];
        }
      } else {
        delete belowSince[id];   // climbed back above 0.15: cancel the countdown
      }
    }

    // If it's ON, report it
    if (startedAt[id] !== undefined) {
      const durationSec = (frame.timestamp - startedAt[id]) / 1000;
      issues.push({
        id: id,
        medical: ISSUES[id].medical,
        layman: ISSUES[id].layman,
        severity: sev,
        durationSec: durationSec,
        sustained: durationSec >= 5,
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
    metrics: { ...sm, severity },
  };
}