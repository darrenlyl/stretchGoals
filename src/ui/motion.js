// Small motion helpers for the UI (owner: Claude via Darren). Plain JS, no library.
//
// Everything here moves transform, opacity, clip-path or an SVG stroke only, and does
// nothing (or only fades) when the person has asked for reduced motion.

const reduceQuery =
  typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : null;

/** true when the OS asks for less motion. Read it each time: it can change while the app runs. */
export const reducedMotion = () => Boolean(reduceQuery?.matches);

// Curves (same values as ui.css, so JS and CSS motion feel like one thing)
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

/**
 * A spring as a CSS linear() easing, so a plain CSS transition can feel like a spring.
 * damping 1 = no overshoot, 0.8 = a small one. response = seconds to (nearly) arrive.
 * Returns { easing, ms }. Old engines without linear() get an iOS-like curve instead.
 */
export function springEasing(damping = 0.8, response = 0.3) {
  const fallback = { easing: 'cubic-bezier(0.32, 0.72, 0, 1)', ms: 380 };
  if (
    typeof CSS === 'undefined' ||
    !CSS.supports('transition-timing-function', 'linear(0, 1)')
  )
    return fallback;
  const omega = (2 * Math.PI) / response;
  const decay = damping * omega;
  const seconds = Math.min(1.2, -Math.log(0.002) / decay); // until it has settled
  const damped = omega * Math.sqrt(Math.max(1e-6, 1 - damping * damping));
  const points = [];
  const STEPS = 48;
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * seconds;
    const x =
      damping < 1
        ? 1 -
          Math.exp(-decay * t) *
            (Math.cos(damped * t) + (decay / damped) * Math.sin(damped * t))
        : 1 - Math.exp(-omega * t) * (1 + omega * t);
    points.push(i === STEPS ? '1' : x.toFixed(4));
  }
  return {
    easing: `linear(${points.join(', ')})`,
    ms: Math.round(seconds * 1000),
  };
}

/**
 * Play a Web Animation. With reduced motion, keyframes that move things are swapped for a
 * short fade so the change still reads. Returns the Animation (or null).
 */
export function play(el, keyframes, options) {
  if (!el?.animate) return null;
  if (reducedMotion()) {
    const fades = keyframes.some((k) => 'opacity' in k);
    if (!fades) return null;
    return el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: 'ease',
    });
  }
  return el.animate(keyframes, { fill: 'backwards', ...options });
}

/** Measure where elements are now, so flip() can slide them from there to wherever they end up. */
export function measure(elements) {
  const rects = new Map();
  for (const el of elements)
    if (el?.isConnected) rects.set(el, el.getBoundingClientRect());
  return rects;
}

/**
 * FLIP: after the layout changed, make each element start where it was and glide to where it is.
 * scale = true also animates size (for cards that change shape between screens).
 */
export function flip(rects, { duration = 420, scale = false } = {}) {
  if (reducedMotion()) return;
  for (const [el, before] of rects) {
    const after = el.getBoundingClientRect();
    if (!after.width || !after.height || !before.width || !before.height)
      continue; // was or is hidden
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    const sx = scale ? before.width / after.width : 1;
    const sy = scale ? before.height / after.height : 1;
    if (
      Math.abs(dx) < 1 &&
      Math.abs(dy) < 1 &&
      Math.abs(sx - 1) < 0.01 &&
      Math.abs(sy - 1) < 0.01
    )
      continue;
    el.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration, easing: EASE_IN_OUT },
    );
  }
}

/**
 * A value that glides toward its target (a critically damped spring), stepped by one shared
 * requestAnimationFrame loop that only runs while something is still moving.
 *   const needle = glide(0, (v) => el.style.transform = `translateX(${v}%)`);
 *   needle.to(80);
 */
const gliders = new Set();
let frame = 0;
let lastTime = 0;

function tick(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
  lastTime = now;
  for (const g of gliders) {
    // Critically damped spring: no overshoot, ~0.45 s to arrive
    const k = 60;
    const accel = k * (g.target - g.value) - 2 * Math.sqrt(k) * g.velocity;
    g.velocity += accel * dt;
    g.value += g.velocity * dt;
    if (Math.abs(g.target - g.value) < 0.02 && Math.abs(g.velocity) < 0.05) {
      g.value = g.target;
      g.velocity = 0;
      gliders.delete(g);
    }
    g.onFrame(g.value);
  }
  frame = gliders.size ? requestAnimationFrame(tick) : 0;
}

export function glide(initial, onFrame) {
  const g = { value: initial, target: initial, velocity: 0, onFrame };
  return {
    to(target) {
      if (target === g.target && !gliders.has(g)) return;
      g.target = target;
      if (reducedMotion()) {
        g.value = target;
        g.velocity = 0;
        gliders.delete(g);
        onFrame(target);
        return;
      }
      gliders.add(g);
      if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    get value() {
      return g.value;
    },
  };
}
