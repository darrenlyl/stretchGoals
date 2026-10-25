// Lets Maizy press the app's buttons when someone asks ("can you start the camera?").
// It reads whatever buttons and switches are visible right now, so new UI works without changes.
//
//   const controls = createAppControls(document.querySelector('#app'));
//   controls.list()        -> [{ id, label, kind, on? }]  what's on screen now
//   await controls.press(id) -> { pressed, ... } clicks it (a switch flips), then lists the screen again

const CLICKABLE = 'button, [role="button"], input[type="checkbox"]';
const SETTLE_MS = 1200; // wait this long after a press before reading the screen again

export function createAppControls(root) {
  let byId = new Map(); // ids from the last list(), so press() hits exactly what she was shown

  // Visible, enabled, and not inside something hidden.
  function usable(el) {
    if (el.disabled || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (el.matches('input')) return Boolean(el.labels?.[0]?.offsetParent ?? el.offsetParent);
    return el.offsetParent !== null;
  }

  // What a person would call it: its text, its aria-label or its <label>, plus the card it sits on
  // when the text alone is vague (a card's "Start" button becomes "Start (Chin tucks)").
  function labelOf(el) {
    const own =
      el.getAttribute('aria-label') ||
      el.labels?.[0]?.innerText ||
      el.innerText ||
      el.title ||
      '';
    const label = own.replace(/\s+/g, ' ').trim();
    if (label.includes(' ')) return label; // "Start camera" says enough on its own
    const heading = el.closest('section, article, .sg-card')?.querySelector('[data-ref="tipName"], h2, h3');
    const context = heading?.innerText.replace(/\s+/g, ' ').trim();
    return context ? `${label} (${context})` : label;
  }

  function list() {
    byId = new Map();
    const items = [];
    for (const el of root.querySelectorAll(CLICKABLE)) {
      if (!usable(el)) continue;
      const label = labelOf(el);
      if (!label) continue;
      const id = `b${items.length + 1}`;
      byId.set(id, el);
      const isSwitch = el.matches('input[type="checkbox"]');
      items.push({ id, label, kind: isSwitch ? 'switch' : 'button', ...(isSwitch && { on: el.checked }) });
    }
    return items;
  }

  async function press(id) {
    const el = byId.get(id);
    if (!el || !el.isConnected || !usable(el)) {
      return { pressed: false, reason: 'That button is not on screen any more. Call list_buttons again.' };
    }
    const label = labelOf(el);
    el.click(); // a switch flips and fires its change event, like a real click
    await new Promise((r) => setTimeout(r, SETTLE_MS)); // e.g. Start camera changes the screen a moment later
    return {
      pressed: label,
      ...(el.matches('input[type="checkbox"]') && { now: el.checked ? 'on' : 'off' }),
      on_screen_now: list(), // the screen may have changed, so fresh ids for the next press
    };
  }

  return { list, press };
}
