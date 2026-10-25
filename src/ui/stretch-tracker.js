// Stretch tracker (owner: Darren, UI). Watches the camera while a stretch runs and checks
// you're really doing it: it counts reps, or times how long you hold the position.
//
//   const tracker = createStretchTracker(stretch)  // null if we don't know how to watch this one
//   tracker.update(frame, stepIndex)               // every PoseFrame while the stretch runs
//   tracker.progress()                             // what to show (see the Progress type below)
//
// How it works:
//   1. The first second of the stretch is "neutral": we remember how you're sitting.
//   2. Every frame we measure a few things (how big the head looks, head tilt, how high the
//      shoulders are...) and compare them with neutral. Each stretch turns that into one number,
//      its "level": 0 = sitting like at the start, 1 = clearly doing the move.
//   3. Level above 1 = you're in position. It has to drop below 0.6 before the next rep can
//      count, so wobbling around 1 doesn't count twice.
//   "reps" stretches count each time you go in (and hold for a moment).
//   "hold" stretches add up the seconds you spend in position, per side.
//
// The numbers that decide "far enough" are in TUNING. Watch them live in src/ui/reps-dev.html.
// No DOM in here, so it also runs in Node: node src/ui/try-tracker.mjs

import { MIN_VISIBILITY } from "../shared/contracts.js";

/**
 * How far each move has to go to count as "in position" (level 1).
 * Head and shoulder sizes are fractions: 0.025 = 2.5%. Angles are degrees.
 * "sw" = shoulder width, the ruler for everything vertical, so it works at any distance.
 */
export const TUNING = {
  chin_tuck: { shrink: 0.025, holdSec: 2 }, // head looks 2.5% smaller = chin slid back
  upper_trap: { tilt: 12 }, // head tipped 12° toward that shoulder
  levator: { drop: 0.08, side: 0.06 }, // nose 0.08 sw lower and 0.06 sw toward that side
  chest_opener: { narrow: 0.035, down: 0.06 }, // shoulders 3.5% narrower (pulled back), or 6% lower
  scap_squeeze: { narrow: 0.035, down: 0.06, holdSec: 2 },
  shoulder_rolls: { up: 0.08, holdSec: 0 }, // shoulders 8% closer to the ears
  seated_extension: { lookUp: 0.12, rise: 0.08, holdSec: 0.5 }, // face tipped up, nose higher
  eye_break: { sitBack: 0.05, away: 0.1 }, // sat back (shoulders 5% smaller), or head turned away
};

const ENTER = 1; // level that counts as in position
const EXIT = 0.6; // level you must drop below before the next rep
// Reps also end when you let go about a third of the way back to where the rep started (at
// least STEP), and the next one needs STEP of rise from where you relaxed. So reps count even
// if you never get back to neutral, e.g. you sit taller after the first one. STEP is well above
// camera jitter, so wobbling while you hold doesn't end a rep.
const STEP = 0.4;
const LET_GO = 0.35; // fraction of the rep's size
const NEUTRAL_FRAMES = 8; // ~0.8 s at 10 frames a second
const SMOOTH = 0.5; // how much each new frame moves the smoothed value (the camera is steady)
const DRIFT = 0.03; // neutral slowly follows you while you're resting, in case you shift in your seat
const UNSEEN_MS = 600; // this long without a usable frame = "we can't see you"

// Every measurement uses + = toward the person's LEFT, so a side flips the sign.
const SIDE_SIGN = { left: 1, right: -1 };

// ---------------------------------------------------------------------------
// Measuring one frame
// ---------------------------------------------------------------------------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Angle of the line from the right point to the left one. + = tipped toward the person's left. */
const angle = (left, right) => (Math.atan2(left.y - right.y, left.x - right.x) * 180) / Math.PI;
/** How far p sits below the line through left and right (in pixels, + = below, toward the chin). */
function below(p, left, right) {
  const m = mid(left, right);
  return ((p.y - m.y) * (left.x - right.x) - (p.x - m.x) * (left.y - right.y)) / dist(left, right);
}

/**
 * The measurements one frame gives us. Any of them can be null when those points are hidden.
 * Each comes in an "ears" and an "eyes" version where hair can hide the ears.
 */
export function measure(frame) {
  if (!frame?.landmarks) return null;
  const at = (i) => {
    const p = frame.landmarks[i];
    if (!p || (p.visibility ?? 1) < MIN_VISIBILITY) return null;
    return { x: p.x * frame.width, y: p.y * frame.height };
  };
  // MediaPipe numbers. "left" is the PERSON's left (the right side of the raw camera image).
  const leftShoulder = at(11);
  const rightShoulder = at(12);
  if (!leftShoulder || !rightShoulder) return null;
  const sw = dist(leftShoulder, rightShoulder);
  if (sw < 1) return null;
  const shoulders = mid(leftShoulder, rightShoulder);
  const nose = at(0);
  const leftEar = at(7);
  const rightEar = at(8);
  const leftEye = at(2);
  const rightEye = at(5);
  const leftEyeOuter = at(3);
  const rightEyeOuter = at(6);

  const f = {
    sw: sw / frame.width, // how wide the shoulders look (smaller = further from the camera)
    earW: null, // how wide the head looks, ear to ear
    eyeW: null, // the same, outer corner of one eye to the other
    neckEars: null, // shoulders to ears, in shoulder widths (smaller = shoulders up)
    neckEyes: null,
    tiltEars: null, // head tilt in degrees
    tiltEyes: null,
    noseH: null, // nose height above the shoulders, in shoulder widths (smaller = looking down)
    noseX: null, // nose left/right of the middle of the shoulders, in shoulder widths
    pitchEars: null, // nose below the ear line, in ear widths (smaller = looking up)
  };
  if (leftEar && rightEar) {
    const earDist = dist(leftEar, rightEar);
    f.earW = earDist / frame.width;
    f.neckEars = (shoulders.y - mid(leftEar, rightEar).y) / sw;
    f.tiltEars = angle(leftEar, rightEar);
    if (nose && earDist > 1) f.pitchEars = below(nose, leftEar, rightEar) / earDist;
  }
  if (leftEye && rightEye) {
    f.neckEyes = (shoulders.y - mid(leftEye, rightEye).y) / sw;
    f.tiltEyes = angle(leftEye, rightEye);
  }
  if (leftEyeOuter && rightEyeOuter) f.eyeW = dist(leftEyeOuter, rightEyeOuter) / frame.width;
  if (nose) {
    f.noseH = (shoulders.y - nose.y) / sw;
    f.noseX = (nose.x - shoulders.x) / sw;
  }
  return f;
}

// Small helpers for the level functions. Each returns null when it can't measure.
/** now minus neutral */
function diff(now, ref, key) {
  return now[key] == null || ref[key] == null ? null : now[key] - ref[key];
}
/** now minus neutral, as a fraction of neutral (0.05 = 5% bigger) */
function rel(now, ref, key) {
  const d = diff(now, ref, key);
  return d == null || !ref[key] ? null : d / Math.abs(ref[key]);
}
/** The average of the numbers that aren't null, or null. */
function avg(...values) {
  const ok = values.filter(Number.isFinite);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

// ---------------------------------------------------------------------------
// The stretches we know how to watch
// ---------------------------------------------------------------------------

/**
 * level(now, neutral, tuning, side) → number or null. 0 = like at the start, 1 = in position.
 * sides: the side each step works on (step 0 = first entry), for stretches done on both sides.
 * reps: the default when the stretch data has no `reps`.
 */
const SPECS = {
  chin_tuck: {
    kind: "reps",
    reps: 6,
    hint: "Slide your chin straight back",
    after: "Nice. Relax, then go again.",
    level(now, ref, t) {
      // The head moves away from the camera, so it looks a little smaller.
      const change = avg(rel(now, ref, "earW"), rel(now, ref, "eyeW"));
      return change == null ? null : -change / t.shrink;
    },
  },
  upper_trap: {
    kind: "hold",
    sides: ["right", "left"],
    hint: (side) => `Tip your ${side} ear toward your ${side} shoulder`,
    level(now, ref, t, side) {
      const tilt = avg(diff(now, ref, "tiltEars"), diff(now, ref, "tiltEyes"));
      return tilt == null ? null : (SIDE_SIGN[side] * tilt) / t.tilt;
    },
  },
  levator: {
    kind: "hold",
    sides: ["right", "left"],
    hint: (side) => `Nose toward your ${side} armpit, then look down`,
    level(now, ref, t, side) {
      // Both have to happen: the nose goes down AND toward that side.
      const drop = diff(now, ref, "noseH");
      const toSide = diff(now, ref, "noseX");
      if (drop == null || toSide == null) return null;
      return Math.min(-drop / t.drop, (SIDE_SIGN[side] * toSide) / t.side);
    },
  },
  chest_opener: {
    kind: "hold",
    hint: "Squeeze your shoulder blades and lift your chest",
    level: shouldersBack,
  },
  scap_squeeze: {
    kind: "reps",
    reps: 5,
    hint: "Squeeze your shoulder blades together",
    after: "Nice. Relax, then squeeze again.",
    level: shouldersBack,
  },
  shoulder_rolls: {
    kind: "reps",
    reps: 10,
    hint: "Lift your shoulders up toward your ears",
    after: "Nice. Back and down, keep rolling.",
    level(now, ref, t) {
      // Shoulders up = less neck showing between them and the head.
      const neck = avg(rel(now, ref, "neckEars"), rel(now, ref, "neckEyes"));
      return neck == null ? null : -neck / t.up;
    },
  },
  seated_extension: {
    kind: "reps",
    reps: 3,
    hint: "Gently arch back over your chair",
    after: "Nice. Sit up, then arch again.",
    level(now, ref, t) {
      // Arching back tips the face up: the nose rises above the ear line and above the shoulders.
      const pitch = diff(now, ref, "pitchEars");
      const rise = diff(now, ref, "noseH");
      return avg(pitch == null ? null : -pitch / t.lookUp, rise == null ? null : rise / t.rise);
    },
  },
  eye_break: {
    kind: "hold",
    hint: "Sit back and look at something far away",
    level(now, ref, t) {
      const sitBack = rel(now, ref, "sw");
      const turned = diff(now, ref, "noseX");
      return Math.max(sitBack == null ? 0 : -sitBack / t.sitBack, turned == null ? 0 : Math.abs(turned) / t.away);
    },
  },
};

/**
 * Shoulder blades squeezed back: the shoulders look narrower, and often sit a little lower.
 * Leaning back in the chair also makes the shoulders look narrower, but the head shrinks with
 * them, so half of the head's change is taken off. "Lower" is measured against the head's size,
 * because narrower shoulders would make the neck look longer in shoulder widths.
 */
function shouldersBack(now, ref, t) {
  const shoulders = rel(now, ref, "sw");
  const head = avg(rel(now, ref, "earW"), rel(now, ref, "eyeW")) ?? 0;
  const narrow = -(shoulders - 0.5 * head);
  const neck = avg(rel(now, ref, "neckEars"), rel(now, ref, "neckEyes"));
  const down = neck == null ? 0 : neck + shoulders - head; // neck gap / head width
  return narrow / t.narrow + Math.max(0, down) / t.down;
}

/** True if we know how to watch this stretch. */
export function canTrack(stretchId) {
  return Boolean(SPECS[stretchId]);
}

/** How many reps a rep stretch asks for (e.g. 6 chin tucks), or null for a timed stretch. */
export function repTarget(stretch) {
  const spec = SPECS[stretch?.id];
  return spec?.kind === "reps" ? targetFor(stretch, spec, 0) : null;
}

// ---------------------------------------------------------------------------
// The tracker
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TrackSide
 * @property {"left"|"right"|null} side
 * @property {number} count   reps done, or whole seconds held
 * @property {number} target
 * @property {boolean} done
 *
 * @typedef {Object} Progress
 * @property {string} id                 the stretch id
 * @property {"reps"|"hold"} kind
 * @property {"warmup"|"unseen"|"in"|"out"|"done"} status
 *           warmup = learning your neutral position, unseen = can't see you, in = in position,
 *           out = not in position, done = this side (or the whole stretch) is finished
 * @property {"left"|"right"|null} side  the side the current step works on
 * @property {number} count              for the current side
 * @property {number} target
 * @property {number} fraction           count / target, 0–1 (for a ring)
 * @property {number} level              how far into the move right now, 0–1.5 (1 = in position)
 * @property {number} rawLevel           the same without the 0–1.5 limits (negative = the other way)
 * @property {boolean} inPosition        in position right now (even after the target is reached)
 * @property {string} hint               what to do, e.g. "Slide your chin straight back"
 * @property {number} holdSec            seconds in position in the current rep (reps only)
 * @property {TrackSide[]} sides         one entry, or right + left
 * @property {boolean} done              every side reached its target
 * @property {string} message            one short line to show
 */

/**
 * Watches one run of a stretch. Make a new one each time a stretch starts.
 * @param {{ id: string, reps?: number, steps?: { seconds: number }[] }} stretch
 * @param {Object} [options]
 * @param {Object[]} [options.before]  PoseFrames from just BEFORE the stretch started (about a
 *        second). You were sitting normally then, so they make the best neutral. Without them
 *        the first second of the stretch is used, which goes wrong if you start moving at once.
 * @param {Partial<typeof TUNING>} [options.tuning]  override thresholds (the tuning page uses this)
 */
export function createStretchTracker(stretch, { before = [], tuning = TUNING } = {}) {
  const spec = SPECS[stretch?.id];
  if (!spec) return null;
  const t = tuning[stretch.id] ?? TUNING[stretch.id];
  const sides = spec.sides ?? [null];
  const targets = sides.map((_, i) => targetFor(stretch, spec, i));
  const holdMs = (t.holdSec ?? 0) * 1000;

  let perSide;
  let neutralFrames;
  let ref; // neutral measurements
  let smooth; // smoothed measurements
  let lastTime;
  let lastSeen;
  let stepIndex = 0;
  reset();

  /** Start over: forget every count. Neutral comes from the frames before the stretch again (if any). */
  function reset() {
    // high = top level of the current rep, low = lowest level since the last rep ended
    perSide = sides.map(() => ({ inMove: false, since: 0, counted: false, reps: 0, heldMs: 0, level: 0, high: 0, low: 0, base: 0 }));
    neutralFrames = [];
    ref = null;
    smooth = null;
    lastTime = null;
    lastSeen = null;
    // Neutral from the frames before the stretch, if there are enough where we could see you
    const seenBefore = (before ?? []).map(measure).filter(Boolean);
    if (seenBefore.length >= 5) ref = medianOf(seenBefore);
  }

  function update(frame, step = stepIndex) {
    stepIndex = Number(step) || 0;
    const now = frame?.timestamp ?? 0;
    // Time since the last frame, capped so a pause in the camera doesn't add a big jump
    const dt = lastTime == null ? 0 : Math.min(250, Math.max(0, now - lastTime));
    lastTime = now;

    const m = measure(frame);
    if (!m) return progress(now);
    smooth = smoothed(smooth, m);

    // 1. The first frames become neutral
    if (!ref) {
      neutralFrames.push(m);
      lastSeen = now;
      if (neutralFrames.length >= NEUTRAL_FRAMES) ref = medianOf(neutralFrames);
      return progress(now);
    }

    // 2. Level for each side, then in/out with a gap between the two lines
    let measured = false;
    let anyIn = false;
    let top = -Infinity;
    sides.forEach((side, i) => {
      const s = perSide[i];
      const level = spec.level(smooth, ref, t, side);
      if (!Number.isFinite(level)) {
        s.level = 0;
        return;
      }
      measured = true;
      s.level = level;
      top = Math.max(top, level);
      if (!s.inMove) {
        // Reps: the next one needs a clear rise from where you relaxed, not just from neutral
        s.low = Math.min(s.low, level);
        const need = spec.kind === "reps" ? Math.max(ENTER, s.low + STEP) : ENTER;
        if (level >= need) {
          s.inMove = true;
          s.since = now;
          s.counted = false;
          s.high = level;
          s.base = s.low; // where this rep started from
        }
      } else {
        s.high = Math.max(s.high, level);
        // Reps: letting go part of the way back ends the rep, even if you relax to somewhere
        // that isn't back at neutral (e.g. sitting taller than before you pressed Start)
        const letGo = spec.kind === "reps" && level < s.high - Math.max(STEP, (s.high - s.base) * LET_GO);
        if (level < EXIT || letGo) {
          s.inMove = false;
          s.low = level;
        }
      }
      if (!s.inMove) return;
      anyIn = true;
      if (spec.kind === "hold") {
        s.heldMs = Math.min(targets[i] * 1000, s.heldMs + dt);
      } else if (!s.counted && now - s.since >= holdMs) {
        s.counted = true;
        s.reps = Math.min(targets[i], s.reps + 1);
      }
    });
    if (measured) lastSeen = now;

    // 3. While you rest, neutral slowly follows you (you shift in your seat). If a one-sided
    //    move goes clearly the wrong way, neutral was caught mid-move: catch up faster.
    if (measured && !anyIn) {
      if (top < 0.4) followNeutral(DRIFT);
      if (sides.length === 1 && top < -EXIT) followNeutral(0.15);
    }
    return progress(now);
  }

  function followNeutral(rate) {
    for (const key in smooth) {
      if (smooth[key] == null) continue;
      ref[key] = ref[key] == null ? smooth[key] : ref[key] + (smooth[key] - ref[key]) * rate;
    }
  }

  /** @returns {Progress} */
  function progress(now = lastTime ?? 0) {
    const i = Math.min(sides.length - 1, Math.max(0, stepIndex));
    const s = perSide[i];
    const counts = perSide.map((p) => (spec.kind === "reps" ? p.reps : Math.floor(p.heldMs / 1000)));
    const sideList = sides.map((side, k) => ({ side, count: counts[k], target: targets[k], done: counts[k] >= targets[k] }));
    const done = sideList.every((x) => x.done);
    const unseen = lastSeen == null ? lastTime != null && neutralFrames.length === 0 : now - lastSeen > UNSEEN_MS;

    let status = "out";
    if (done || sideList[i].done) status = "done";
    else if (unseen) status = "unseen";
    else if (!ref) status = "warmup";
    else if (s.inMove) status = "in";

    return {
      id: stretch.id,
      kind: spec.kind,
      status,
      side: sides[i],
      count: counts[i],
      target: targets[i],
      fraction: Math.min(1, counts[i] / targets[i]),
      level: status === "warmup" || status === "unseen" ? 0 : Math.max(0, Math.min(1.5, s.level)),
      rawLevel: s.level,
      inPosition: s.inMove && status !== "unseen" && status !== "warmup",
      hint: typeof spec.hint === "function" ? spec.hint(sides[i]) : spec.hint,
      holdSec: s.inMove ? Math.max(0, (now - s.since) / 1000) : 0,
      sides: sideList,
      done,
      message: messageFor(status, s, i, sideList, done),
    };
  }

  function messageFor(status, s, i, sideList, done) {
    const side = sides[i];
    const Side = side ? side.charAt(0).toUpperCase() + side.slice(1) : "";
    const hint = typeof spec.hint === "function" ? spec.hint(side) : spec.hint;
    if (done) return spec.kind === "reps" ? `All ${targets[0]} done. Nice work!` : sides.length > 1 ? "Both sides done. Nice work!" : "Done. Nice work!";
    if (status === "done") {
      const other = sideList.find((x) => !x.done);
      return `${Side} side done.${other ? ` ${cap(other.side)} side next.` : ""}`;
    }
    if (status === "unseen") return "We can't see you. Keep your head and shoulders in view.";
    if (status === "warmup") return "Getting ready…";
    if (status === "in") {
      if (spec.kind === "hold") return "That's it. Hold it there.";
      return s.counted ? spec.after ?? "Nice. Now relax." : "Hold it…";
    }
    return perSide[i].reps > 0 ? `Again: ${hint.charAt(0).toLowerCase()}${hint.slice(1)}` : hint;
  }

  return { id: stretch.id, kind: spec.kind, holdSec: t.holdSec ?? 0, update, progress, reset, neutral: () => ref, latest: () => smooth };
}

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Reps from the stretch data. Holds: the step's length minus 5 s to get into position. */
function targetFor(stretch, spec, sideIndex) {
  if (spec.kind === "reps") return Math.max(1, Math.round(Number(stretch.reps) || spec.reps || 5));
  const steps = Array.isArray(stretch.steps) ? stretch.steps : [];
  const seconds = spec.sides ? steps[sideIndex]?.seconds : Math.max(0, ...steps.map((step) => Number(step?.seconds) || 0));
  return Math.max(5, (Number(seconds) || 20) - 5);
}

function smoothed(prev, m) {
  const next = {};
  for (const key in m) {
    if (m[key] == null) next[key] = null;
    else if (prev?.[key] == null) next[key] = m[key];
    else next[key] = prev[key] + (m[key] - prev[key]) * SMOOTH;
  }
  return next;
}

/** The middle value of each measurement (ignores frames where it was hidden). */
function medianOf(list) {
  const out = {};
  for (const key in list[0]) {
    const values = list.map((m) => m[key]).filter(Number.isFinite).sort((a, b) => a - b);
    out[key] = values.length >= list.length / 2 ? values[Math.floor(values.length / 2)] : null;
  }
  return out;
}
