// The body chart beside the findings (owner: Claude via Darren).
//
// Two small line figures, like the body chart on a physio's assessment form: a side view
// (forward head, slouching, too close to the screen) and a front view (head tilt, uneven
// shoulders). They bend with metrics.severity, so you can watch a problem build. Purely
// decorative (aria-hidden): the findings list next to it says the same thing in words.
//
//   const figure = createBodyChart();   // figure.el goes in the page once
//   figure.update(severity, metrics, states)   // states: { issueId: "fine" | "active" | "sustained" }

// How far each part bends at severity 1, in degrees (or px for the screen)
const BEND = {
  slouching: 22,
  forward_head: 30,
  head_tilt: 16,
  uneven_shoulders: 11,
  too_close: 14,
};

// Vertebrae as small rounded blocks along a vertical line, in the group's own coordinates
function vertebrae(x, top, bottom, count, width) {
  const gap = (bottom - top) / count;
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = top + i * gap + 0.8;
    out += `<rect x="${x - width / 2}" y="${y.toFixed(1)}" width="${width}" height="${(gap - 1.6).toFixed(1)}" rx="1.4" />`;
  }
  return out;
}

const MARKUP = `
<svg viewBox="0 0 150 156" class="sg-figure-svg" aria-hidden="true" focusable="false">
  <!-- Side view: faces right, towards the screen -->
  <g class="sg-fig-side">
    <line class="sg-fig-floor" x1="6" y1="148" x2="74" y2="148" />
    <g class="sg-fig-part" data-part="too_close">
      <g data-bend="too_close"><rect class="sg-fig-screen" x="66" y="30" width="4" height="40" rx="1" /></g>
    </g>
    <g class="sg-fig-part sg-fig-spine" data-part="slouching">
      ${vertebrae(30, 108, 146, 4, 9)}
      <g data-bend="slouching" style="transform-origin: 30px 108px">
        ${vertebrae(30, 62, 108, 6, 8)}
        <line class="sg-fig-bone" x1="30" y1="66" x2="44" y2="70" />
        <g class="sg-fig-part" data-part="forward_head">
          <g data-bend="forward_head" style="transform-origin: 30px 62px">
            ${vertebrae(30, 46, 62, 3, 6)}
            <circle class="sg-fig-head" cx="32" cy="33" r="12" />
            <line class="sg-fig-eye" x1="40" y1="31" x2="44" y2="31" />
          </g>
        </g>
      </g>
    </g>
  </g>

  <!-- Front view -->
  <g class="sg-fig-front" transform="translate(76 0)">
    <line class="sg-fig-floor" x1="4" y1="148" x2="70" y2="148" />
    <line class="sg-fig-bone sg-fig-faint" x1="37" y1="62" x2="37" y2="146" />
    ${vertebrae(37, 64, 146, 10, 6)}
    <g class="sg-fig-part" data-part="uneven_shoulders">
      <g data-bend="uneven_shoulders" style="transform-origin: 37px 62px">
        <line class="sg-fig-shoulders" x1="11" y1="62" x2="63" y2="62" />
        <circle class="sg-fig-joint" cx="11" cy="62" r="2.6" />
        <circle class="sg-fig-joint" cx="63" cy="62" r="2.6" />
      </g>
    </g>
    <g class="sg-fig-part" data-part="head_tilt">
      <g data-bend="head_tilt" style="transform-origin: 37px 60px">
        <line class="sg-fig-bone" x1="37" y1="45" x2="37" y2="60" />
        <circle class="sg-fig-head" cx="37" cy="31" r="12" />
        <line class="sg-fig-level" x1="20" y1="31" x2="54" y2="31" />
      </g>
    </g>
  </g>
</svg>`;

export function createBodyChart() {
  const el = document.createElement('div');
  el.className = 'sg-figure';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = MARKUP;

  const bends = {};
  const parts = {};
  el.querySelectorAll('[data-bend]').forEach(
    (g) => (bends[g.dataset.bend] = { g, key: '' }),
  );
  el.querySelectorAll('[data-part]').forEach(
    (g) => (parts[g.dataset.part] = g),
  );

  /** Pose the figure. Only touches an attribute when its value changed. */
  function update(severity = {}, metrics = {}, states = {}) {
    for (const id of Object.keys(BEND)) {
      const amount = Math.min(1, Math.max(0, Number(severity[id]) || 0));
      let transform;
      if (id === 'too_close')
        transform = `translateX(${(-amount * BEND[id]).toFixed(1)}px)`;
      else {
        // Tilts lean the way the person leans (mirror view: their left is on screen left)
        const raw =
          id === 'head_tilt'
            ? metrics.headTiltDeg
            : id === 'uneven_shoulders'
              ? metrics.shoulderTiltDeg
              : 1;
        const sign =
          id === 'head_tilt' || id === 'uneven_shoulders'
            ? Number(raw) < 0
              ? 1
              : -1
            : 1;
        transform = `rotate(${(sign * amount * BEND[id]).toFixed(1)}deg)`;
      }
      const bend = bends[id];
      if (bend.key !== transform) {
        bend.key = transform;
        bend.g.style.transform = transform;
      }
      const state = states[id] ?? 'fine';
      if (parts[id].dataset.state !== state) parts[id].dataset.state = state;
    }
  }

  return { el, update };
}
