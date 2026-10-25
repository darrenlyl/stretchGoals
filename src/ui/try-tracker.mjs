// Try the stretch tracker without a webcam.
//
//   node src/ui/try-tracker.mjs                         fake person: does every stretch, then sits still
//   node src/ui/try-tracker.mjs chin_tuck rec.json      play a recording through one stretch's tracker
//
// Recordings are PoseFrame arrays: the ones in data/recordings/, or a file saved from
// src/ui/reps-dev.html ("Record 20 s").
import { readFileSync } from "node:fs";
import { STRETCHES } from "../stretches/index.js";
import { createStretchTracker } from "./stretch-tracker.js";
import { fakeFrame } from "./fake-moves.js";

const [stretchArg, fileArg] = process.argv.slice(2);
const find = (id) => STRETCHES.find((s) => s.id === id);

if (fileArg) {
  playRecording(find(stretchArg), JSON.parse(readFileSync(fileArg, "utf8")));
} else {
  selfTest();
}

/** Prints the tracker's view twice a second. */
function playRecording(stretch, frames) {
  if (!stretch) throw new Error(`Unknown stretch "${stretchArg}". Try: ${STRETCHES.map((s) => s.id).join(", ")}`);
  const tracker = createStretchTracker(stretch);
  const start = frames[0].timestamp;
  // Steps by time, like the real timer
  const stepAt = (sec) => {
    let total = 0;
    for (let i = 0; i < stretch.steps.length; i++) {
      total += stretch.steps[i].seconds;
      if (sec < total) return i;
    }
    return stretch.steps.length - 1;
  };
  let nextPrint = 0;
  console.log(`${stretch.name}: ${tracker.kind}\n  time | level | status  | count     | message`);
  let p;
  for (const frame of frames) {
    const sec = (frame.timestamp - start) / 1000;
    p = tracker.update(frame, stepAt(sec));
    if (sec >= nextPrint) {
      nextPrint += 0.5;
      const count = `${p.side ? p.side[0].toUpperCase() + " " : ""}${p.count}/${p.target}`;
      console.log(`${sec.toFixed(1).padStart(5)}s | ${p.level.toFixed(2).padStart(5)} | ${p.status.padEnd(7)} | ${count.padEnd(9)} | ${p.message}`);
    }
  }
  console.log("final:", p.sides.map((s) => `${s.side ?? "count"} ${s.count}/${s.target}${s.done ? " done" : ""}`).join(", "));
}

/**
 * The fake person does each stretch the way the voice asks, then sits still for a while.
 * Checks the counts come out right and that sitting still counts nothing.
 */
function selfTest() {
  let failures = 0;
  const check = (ok, text) => {
    console.log(`${ok ? "  ok  " : "  FAIL"} ${text}`);
    if (!ok) failures++;
  };

  // In the app the camera runs before you press Start, so the tracker gets ~1.5 s of you sitting normally
  const before = (id) => Array.from({ length: 15 }, (_, i) => fakeFrame({ stretchId: id, amount: 0, timestamp: (i - 15) * 100 }));

  for (const stretch of STRETCHES) {
    const tracker = createStretchTracker(stretch, { before: before(stretch.id) });
    if (!tracker) {
      console.log(`  --   ${stretch.id}: not tracked`);
      continue;
    }
    // Build a timeline of { amount, side, step } at 10 frames a second
    const timeline = [];
    const add = (seconds, amount, side = "right", step = 0) => {
      for (let i = 0; i < seconds * 10; i++) timeline.push({ amount, side, step });
    };
    const two = tracker.progress().sides.length > 1;
    add(0.5, 0); // reading the first step
    if (tracker.kind === "hold" && two) {
      for (const [step, side] of [[0, "right"], [1, "left"]]) {
        add(2, 0, side, step);
        add(tracker.progress().sides[step].target + 1, 1, side, step); // hold a bit longer than needed
        add(1, 0, side, step);
      }
    } else if (tracker.kind === "hold") {
      add(tracker.progress().target + 1, 1);
      add(1, 0);
    } else {
      const holdSec = { chin_tuck: 2.5, scap_squeeze: 2.5, seated_extension: 1.5, shoulder_rolls: 0.8 }[stretch.id] ?? 2;
      for (let r = 0; r < tracker.progress().target; r++) {
        // ease in, hold, ease out: a real person doesn't snap into position
        for (let k = 1; k <= 5; k++) timeline.push({ amount: k / 5, side: "right", step: 1 });
        add(holdSec, 1, "right", 1);
        for (let k = 4; k >= 0; k--) timeline.push({ amount: k / 5, side: "right", step: 1 });
        add(1, 0, "right", 1);
      }
    }

    let p;
    timeline.forEach((f, i) => {
      p = tracker.update(fakeFrame({ stretchId: stretch.id, amount: f.amount, side: f.side, timestamp: i * 100 }), f.step);
    });
    check(p.done, `${stretch.id.padEnd(16)} does it right → ${p.sides.map((s) => `${s.side ?? ""} ${s.count}/${s.target}`).join(", ")}`);

    // Sitting still the whole time: nothing should count
    const still = createStretchTracker(stretch, { before: before(stretch.id) });
    for (let i = 0; i < 400; i++) p = still.update(fakeFrame({ stretchId: stretch.id, amount: 0, timestamp: i * 100 }), i < 200 ? 0 : 1);
    check(p.sides.every((s) => s.count === 0), `${stretch.id.padEnd(16)} sitting still → ${p.sides.map((s) => s.count).join(", ")}`);

    // Half-hearted moves (35% of the way), starting straight away, shouldn't count either
    const half = createStretchTracker(stretch, { before: before(stretch.id) });
    for (let i = 0; i < 400; i++) {
      const amount = 0.35 * (Math.sin(i / 8) > 0 ? 1 : 0);
      p = half.update(fakeFrame({ stretchId: stretch.id, amount, side: i < 200 ? "right" : "left", timestamp: i * 100 }), i < 200 ? 0 : 1);
    }
    check(p.sides.every((s) => s.count === 0), `${stretch.id.padEnd(16)} tiny moves → ${p.sides.map((s) => s.count).join(", ")}`);
  }

  // Wrong side: tilting LEFT during the "right" step shouldn't count for the right side
  const trap = createStretchTracker(find("upper_trap"), { before: before("upper_trap") });
  let p;
  for (let i = 0; i < 300; i++) p = trap.update(fakeFrame({ stretchId: "upper_trap", amount: i < 15 ? 0 : 1, side: "left", timestamp: i * 100 }), 0);
  check(p.sides[0].count === 0 && p.sides[1].count > 0, `upper_trap       wrong side → right ${p.sides[0].count}, left ${p.sides[1].count}`);

  // After the first rep you relax, but sit taller than before you pressed Start (that looks like
  // half a squeeze). Every squeeze from there should still count.
  for (const id of ["scap_squeeze", "chin_tuck", "shoulder_rolls"]) {
    const t = createStretchTracker(find(id), { before: before(id) });
    let i = 0;
    const at = (amount, frames) => {
      for (let k = 0; k < frames; k++) p = t.update(fakeFrame({ stretchId: id, amount, timestamp: i++ * 100 }), 1);
    };
    at(0, 5);
    for (let r = 0; r < t.progress().target; r++) {
      at(1.4, 30); // squeeze and hold 3 s
      at(0.7, 15); // relax, but only part of the way
    }
    check(p.done, `${id.padEnd(16)} relaxing only halfway → ${p.count}/${p.target}`);
  }

  // No frames from before (e.g. the camera just started): the first second becomes neutral
  const late = createStretchTracker(find("chin_tuck"));
  for (let i = 0; i < 200; i++) p = late.update(fakeFrame({ stretchId: "chin_tuck", amount: i > 15 && i % 50 > 20 ? 1 : 0, timestamp: i * 100 }), 1);
  check(p.count === 4, `chin_tuck        no frames from before → ${p.count} reps (want 4)`);

  // Real recordings of someone NOT stretching: count what each tracker would (want 0)
  console.log("\nReal recordings, nobody stretching (should all be 0):");
  for (const name of ["upright", "slouch", "transition", "forward_head", "uneven_shoulders_1"]) {
    const frames = JSON.parse(readFileSync(`data/recordings/${name}.json`, "utf8"));
    const row = [];
    for (const stretch of STRETCHES) {
      const tracker = createStretchTracker(stretch);
      if (!tracker) continue;
      let q;
      frames.forEach((f) => (q = tracker.update(f, 0)));
      row.push(`${stretch.id} ${q.sides.map((s) => s.count).join("/")}`);
    }
    console.log(`  ${name.padEnd(20)} ${row.join("  ")}`);
  }

  // Real head tilt to the right after sitting upright: upper_trap should time the right side
  const upright = JSON.parse(readFileSync("data/recordings/upright.json", "utf8")).slice(0, 20);
  const tiltRight = JSON.parse(readFileSync("data/recordings/head_tilt_right.json", "utf8"));
  const joined = [...upright, ...tiltRight].map((f, i) => ({ ...f, timestamp: i * 100 }));
  const real = createStretchTracker(find("upper_trap"));
  joined.forEach((f) => (p = real.update(f, 0)));
  check(p.sides[0].done && p.sides[1].count === 0, `real head_tilt_right recording → right ${p.sides[0].count}/${p.sides[0].target}, left ${p.sides[1].count}`);

  console.log(failures ? `\n${failures} failed` : "\nAll good");
  process.exitCode = failures ? 1 : 0;
}
