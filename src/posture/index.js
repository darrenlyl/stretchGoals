import { computeMetrics } from "./metrics.js";
import { computeSeverities, computeScore } from "./severity.js";
import { ISSUES } from "../shared/contracts.js";

let baseline = null;

// TEMPORARY: lets us test before calibration exists
export function setBaseline(b) {
  baseline = b;
}

export function analyze(frame) {
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

  const severity = computeSeverities(m, baseline);
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