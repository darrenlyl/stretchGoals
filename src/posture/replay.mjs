// Play a recording through the posture brain and print a timeline.
// Usage: node src/posture/replay.mjs data/recordings/slouch.json
import { readFileSync } from "node:fs";
import { analyze, startCalibration } from "./index.js";

// 1. Load a recording: text file → list of frames
function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const file = process.argv[2];
const frames = load(file);
const upright = load("data/recordings/upright.json");

// 2. Calibrate on the upright recording
const done = startCalibration(3000);
for (const f of upright) analyze(f);
const result = await done;
console.log("calibration:", result.ok ? "OK" : result.reason);

// 3 + 4. Play the recording, print every 0.5 s
const start = frames[0].timestamp;
let nextPrint = 0;
console.log(" time | score | issues");
for (const f of frames) {
  const s = analyze(f);
  const sec = (f.timestamp - start) / 1000;

  if (sec >= nextPrint) {
        const text = s.issues
      .map((i) => `${i.id} ${i.severity.toFixed(2)} (${i.durationSec.toFixed(1)}s)${i.sustained ? " SUSTAINED" : ""}`)
      .join(", ");
    console.log(sec.toFixed(1).padStart(5) + "s |", String(s.score).padStart(5), "|", text || "ok");
    nextPrint += 0.5;
  }
}