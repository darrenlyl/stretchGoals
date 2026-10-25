// Maizy: a blonde girl drawn as a 10-frame flipbook (maizy-strip.webp, side view).
// Frame 0 is fully slumped with her eyes shut; each 10 posture points she stands a little taller
// and cheers up; frame 9 (90+) she beams, and from 95 sparkles twinkle around her.
// Ported from the team's BlondieArt.tsx to plain JS. One frame shows at a time; on top: breathing,
// a slow sway, and a stretch while rising (squash while slumping) that settles with a small bounce.
import { ISSUE_IDS } from '../shared/contracts.js';
import stripUrl from './maizy-strip.webp';
import './maizy.css';

const FRAMES = 10;
const CELL_W = 315; // one frame in the strip, in pixels
const CELL_H = 406;
const FEET_X = 146; // feet position inside a frame; she sways and squashes around this point
const FEET_Y = 398;
const FILTER_RATE = 8; // per second: smooths camera jitter before it picks a frame
const DROP_MARGIN = 1.5; // points: keep a frame until the score falls this far below it (no flicker)
const SPARKLE_ON = 95;
const SPARKLE_OFF = 93.5;
const STEP_MS = 75; // ~13 frames a second when walking between frames
const BREATH_S = 4.2;
const SWAY_S = 6.8;
const CELEBRATE_MS = 2000;
const SCORE_GOOD = 80;
const MINI_PX = 96; // at or below this width, show just her head and shoulders

// Sparkle spots around her head and shoulders, in frame pixels; r is half the size.
const SPARKLES = [
  { x: 28, y: 36, r: 22 },
  { x: 300, y: 24, r: 26 },
  { x: 318, y: 150, r: 17 },
  { x: 8, y: 176, r: 16 },
  { x: 282, y: 256, r: 20 },
  { x: 168, y: -14, r: 15 },
  { x: 34, y: 296, r: 14 },
  { x: 236, y: -2, r: 11 },
  { x: 320, y: 330, r: 12 },
];
const STAR = 'M0-1C.14-.14.14-.14 1 0 .14.14.14.14 0 1-.14.14-.14.14-1 0-.14-.14-.14-.14 0-1Z';

// Makes one Maizy. The app uses the shared `maizy` at the bottom.
export function createMaizy() {
  let host = null;
  let parts = {};
  let stars = [];
  let size = { s: 1, cellW: CELL_W };
  let rafId = null;
  let resizeObserver = null;
  let reduceMotion = false;
  let lastUpdate = 0;

  // Posture 0 (slumped) to 1 (tall) and vitality 0 to 1. The loop eases `current` toward `target`.
  const target = { p: 0.6, v: 0.5 };
  const current = { ...target };
  let autoVitality = 0.5;
  let manualVitality = null;

  let shown = frameOf(target.p);
  let goal = shown;
  let nextStepAt = 0;
  let run = 0; // steps taken in the current move
  let kick = 0; // +1 stretch (rising), -1 squash (slumping); fades out
  let sparkOn = false;
  let spark = 0;
  let celebrateUntil = 0;
  let hadSustainedIssue = false;

  function mount(el) {
    host = el;
    el.innerHTML = `
      <div class="maizy" role="img" aria-label="Maizy, mirroring your posture">
        <div class="m-body"><img class="m-strip" src="${stripUrl}" alt="" draggable="false" decoding="async" /></div>
        <div class="m-stars">${SPARKLES.map(() => `<svg viewBox="-1 -1 2 2"><path d="${STAR}" fill="#ffd966" /><path d="${STAR}" fill="#fffbe8" transform="scale(.45)" /></svg>`).join('')}</div>
        <div class="m-bubble">?</div>
      </div>`;
    parts = {
      root: el.querySelector('.maizy'),
      body: el.querySelector('.m-body'),
      strip: el.querySelector('.m-strip'),
    };
    stars = [...el.querySelectorAll('.m-stars svg')];
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Size her to fit the box whenever it changes
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(el);
    layout();

    cancelAnimationFrame(rafId);
    if (reduceMotion) snap();
    else rafId = requestAnimationFrame(tick);
  }

  // Full figure: fit the frame to the box. Mini: zoom into head and shoulders so her face stays readable.
  function layout() {
    const w = host.clientWidth || 240;
    const h = host.clientHeight || 300;
    const mini = w <= MINI_PX;
    const s = mini ? w / (CELL_H * 0.52) : Math.min(h / CELL_H, w / CELL_W);
    const cellW = CELL_W * s;
    const cellH = CELL_H * s;
    const left = mini ? w / 2 - cellW * 0.62 : (w - cellW) / 2;
    const top = mini ? 0 : h - cellH;
    size = { s, cellW };

    parts.root.classList.toggle('is-mini', mini);
    for (const box of [parts.body, parts.root.querySelector('.m-stars')]) {
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${cellW}px`, height: `${cellH}px` });
    }
    parts.body.style.transformOrigin = `${FEET_X * s}px ${FEET_Y * s}px`;
    Object.assign(parts.strip.style, { width: `${cellW * FRAMES}px`, height: `${cellH}px` });
    SPARKLES.forEach((p, i) => {
      Object.assign(stars[i].style, {
        left: `${(p.x - p.r) * s}px`, top: `${(p.y - p.r) * s}px`, width: `${p.r * 2 * s}px`, height: `${p.r * 2 * s}px`,
      });
    });
    showFrame(shown);
  }

  // Reads a PostureState (~10 times a second).
  function update(state) {
    if (!parts.root || !state) return;
    const now = performance.now();
    const dt = lastUpdate ? Math.min(1, (now - lastUpdate) / 1000) : 0;
    lastUpdate = now;

    const present = state.present;
    // 0.6 when there's no live score (camera off, nobody there, not calibrated)
    target.p = !present || state.score === null ? 0.6 : clamp01(state.score / 100);

    const issues = state.issues ?? [];
    const sustained = issues.filter((issue) => issue.sustained).map((issue) => issue.id);
    const tall = present && state.score !== null && state.score >= SCORE_GOOD && issues.length === 0;

    // Vitality grows while you sit tall and fades while an issue lasts
    if (tall) autoVitality += 0.04 * dt;
    else if (sustained.length > 0) autoVitality -= 0.03 * dt;
    autoVitality = clamp01(autoVitality);
    target.v = manualVitality ?? autoVitality;

    parts.root.classList.toggle('is-away', !present);
    for (const id of ISSUE_IDS) parts.root.classList.toggle(`warn-${id}`, sustained.includes(id));
    parts.root.classList.toggle('is-warn', sustained.length > 0);

    // Cheer when an issue you were warned about is fixed
    if (sustained.length > 0) hadSustainedIssue = true;
    if (hadSustainedIssue && present && issues.length === 0) {
      hadSustainedIssue = false;
      celebrate();
    }

    if (reduceMotion) snap();
  }

  // Jumps to her happiest frame with sparkles for a couple of seconds.
  function celebrate() {
    celebrateUntil = performance.now() + CELEBRATE_MS;
    autoVitality = clamp01(autoVitality + 0.15);
  }

  // Optional: set vitality yourself (0 to 1), or null to let posture drive it.
  function setVitality(value) {
    manualVitality = value === null ? null : clamp01(value);
    target.v = manualVitality ?? autoVitality;
    if (reduceMotion) snap();
  }

  // --- Drawing helpers ---

  function showFrame(i) {
    if (parts.strip) parts.strip.style.transform = `translateX(${-i * size.cellW}px)`;
  }

  // Vitality brings her colour
  function tint(v) {
    parts.body.style.filter = `saturate(${(0.6 + 0.4 * clamp01(v)).toFixed(2)})`;
  }

  function setStar(i, opacity, scale, turn) {
    stars[i].style.opacity = opacity.toFixed(3);
    stars[i].style.transform = `scale(${scale.toFixed(3)}) rotate(${turn.toFixed(1)}deg)`;
  }

  // Reduced motion: no animation, just the right frame
  function snap() {
    Object.assign(current, target);
    const celebrating = performance.now() < celebrateUntil;
    shown = goal = celebrating ? FRAMES - 1 : frameOf(current.p);
    showFrame(shown);
    tint(current.v);
    parts.body.style.transform = '';
    const on = scoreOf(current.p) >= SPARKLE_ON || celebrating;
    SPARKLES.forEach((_, i) => setStar(i, on ? 1 : 0, 0.85, 0));
  }

  // --- Animation loop ---

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * FILTER_RATE);
    current.p += (target.p - current.p) * k;
    current.v += (target.v - current.v) * k;
    // Land exactly, so a score of 90 or 95 actually crosses its line instead of creeping toward it
    if (Math.abs(target.p - current.p) < 5e-4) current.p = target.p;

    const celebrating = now < celebrateUntil;
    // While cheering she stands at her tallest
    const p = celebrating ? 1 : current.p;

    // Bands of 10 points: rise as soon as the next band is reached, drop only once the score is
    // clearly below the current one, so a score hovering at 70 doesn't flicker.
    const score = scoreOf(p);
    const band = frameOf(p);
    if (band > goal || score < goal * 10 - DROP_MARGIN) goal = band;

    // Walk one frame at a time toward the goal, easing in and out
    if (shown !== goal && now >= nextStepAt) {
      const dir = goal > shown ? 1 : -1;
      shown += dir;
      showFrame(shown);
      const remaining = Math.abs(goal - shown);
      nextStepAt = now + STEP_MS * (run === 0 || remaining === 1 ? 1.4 : 1);
      run = remaining === 0 ? 0 : run + 1;
      kick = remaining === 0 ? -dir * 0.8 : dir; // arrive with a small settle bounce
    } else if (shown === goal) {
      run = 0;
    }
    kick *= Math.exp(-dt * 8);

    // Breathing and a slow sway; livelier with more vitality
    const t = now / 1000;
    const lively = 0.5 + 0.5 * clamp01(current.v);
    const breath = Math.sin(t * ((2 * Math.PI) / BREATH_S)) * 0.012 * lively;
    const bounce = celebrating ? Math.abs(Math.sin(t * 9)) * 0.04 : 0;
    const sway = Math.sin(t * ((2 * Math.PI) / SWAY_S)) * 0.7 * lively;
    const sy = 1 + breath + kick * 0.025 + bounce;
    const sx = 1 - breath * 0.4 - kick * 0.012;
    parts.body.style.transform = `rotate(${sway.toFixed(3)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    tint(current.v);

    // Sparkles fade in at 95 (out below 93.5), each twinkling on its own beat. They wait for her
    // to reach the top frame so they arrive with the big smile.
    if (score >= SPARKLE_ON) sparkOn = true;
    else if (score < SPARKLE_OFF) sparkOn = false;
    const sparkGoal = (sparkOn || celebrating) && shown === FRAMES - 1 ? 1 : 0;
    const prevSpark = spark;
    spark += (sparkGoal - spark) * (1 - Math.exp(-dt * 6));
    if (spark > 0.002 || prevSpark > 0.002) {
      SPARKLES.forEach((_, i) => {
        const period = 1.3 + (i % 3) * 0.35;
        const tw = (0.5 + 0.5 * Math.sin(2 * Math.PI * (t / period + i * 0.618))) ** 2;
        setStar(i, spark * (0.35 + 0.65 * tw), spark * (0.55 + 0.45 * tw), 30 * tw);
      });
    }
    rafId = requestAnimationFrame(tick);
  }

  return { mount, update, celebrate, setVitality };
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0;
}
function scoreOf(p) {
  return clamp01(p) * 100;
}
function frameOf(p) {
  return Math.min(FRAMES - 1, Math.floor((scoreOf(p) + 1e-6) / 10));
}

// The one Maizy the app uses
export const maizy = createMaizy();
