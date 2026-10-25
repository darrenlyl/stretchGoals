// Dev only: a fake person doing a stretch, as PoseFrames. Not used by the app.
// The UI playground (src/ui/dev.html) and src/ui/try-tracker.mjs use it to test
// src/ui/stretch-tracker.js without a webcam.
//
//   fakeFrame({ stretchId, amount, side, timestamp })
//     amount: 0 = sitting normally, 1 = doing the move about as far as a real person would
//     side:   "left" | "right" for stretches done on both sides

// Where each point sits when sitting normally (0–1 of the raw, un-mirrored image).
// The person's LEFT side is on the RIGHT of the raw image, like a real camera.
const BASE = {
  0: [0.5, 0.42], // nose
  1: [0.52, 0.385], // left eye inner
  2: [0.535, 0.385], // left eye
  3: [0.55, 0.385], // left eye outer
  4: [0.48, 0.385], // right eye inner
  5: [0.465, 0.385], // right eye
  6: [0.45, 0.385], // right eye outer
  7: [0.575, 0.4], // left ear
  8: [0.425, 0.4], // right ear
  9: [0.515, 0.46], // mouth left
  10: [0.485, 0.46], // mouth right
  11: [0.7, 0.7], // left shoulder
  12: [0.3, 0.7], // right shoulder
};
const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SHOULDERS = [11, 12];
const W = 640;
const H = 480;

/** One fake PoseFrame. Tiny random jitter, like a real camera. */
export function fakeFrame({ stretchId = "", amount = 0, side = "right", timestamp = 0, jitter = 0.0008 } = {}) {
  // Work in pixels so angles come out right, then convert back to 0–1
  const p = {};
  for (const [i, [x, y]] of Object.entries(BASE)) p[i] = { x: x * W, y: y * H };
  const a = Math.max(0, amount);
  const sign = side === "left" ? 1 : -1; // + = toward the person's left (higher x in the raw image)
  const sw = p[11].x - p[12].x;
  const neckBase = { x: (p[11].x + p[12].x) / 2, y: p[11].y - 0.25 * sw };
  const headCenter = { x: (p[7].x + p[8].x) / 2, y: (p[7].y + p[8].y) / 2 };

  const move = (ids, dx, dy) => ids.forEach((i) => ((p[i].x += dx), (p[i].y += dy)));
  const scale = (ids, k, c) => ids.forEach((i) => ((p[i].x = c.x + (p[i].x - c.x) * k), (p[i].y = c.y + (p[i].y - c.y) * k)));
  const rotate = (ids, deg, c) => {
    const r = (deg * Math.PI) / 180;
    ids.forEach((i) => {
      const dx = p[i].x - c.x;
      const dy = p[i].y - c.y;
      p[i].x = c.x + dx * Math.cos(r) - dy * Math.sin(r);
      p[i].y = c.y + dx * Math.sin(r) + dy * Math.cos(r);
    });
  };

  switch (stretchId) {
    case "chin_tuck": // head slides back: looks ~5% smaller
      scale(HEAD, 1 - 0.05 * a, headCenter);
      break;
    case "upper_trap": // ear toward shoulder: head rotates ~25°
      rotate(HEAD, sign * 25 * a, neckBase);
      break;
    case "levator": // nose toward one armpit, then down
      move(HEAD, sign * 0.06 * sw * a, 0.05 * sw * a);
      move([0, 9, 10], sign * 0.08 * sw * a, 0.12 * sw * a);
      break;
    case "chest_opener":
    case "scap_squeeze": // shoulders pulled back (narrower) and a little down
      p[11].x -= 0.03 * sw * a;
      p[12].x += 0.03 * sw * a;
      move(SHOULDERS, 0, 0.02 * sw * a);
      break;
    case "shoulder_rolls": // shoulders up toward the ears
      move(SHOULDERS, 0, -0.1 * sw * a);
      break;
    case "seated_extension": // face tips up: nose rises above the ear line
      move([0, 9, 10], 0, -0.25 * (p[7].x - p[8].x) * a);
      move(HEAD, 0, -0.03 * sw * a);
      break;
    case "eye_break": // sit back: everything ~8% smaller
      scale([...HEAD, ...SHOULDERS], 1 - 0.08 * a, { x: W / 2, y: H / 2 });
      break;
  }

  const landmarks = [];
  for (let i = 0; i < 33; i++) {
    const point = p[i];
    const wobble = () => (Math.random() - 0.5) * 2 * jitter;
    landmarks.push(
      point
        ? { x: point.x / W + wobble(), y: point.y / H + wobble(), z: 0, visibility: 0.99 }
        : { x: 0.5, y: 1.2, z: 0, visibility: 0.05 }, // arms and hips: out of frame
    );
  }
  return { timestamp, width: W, height: H, landmarks };
}
