// Health check: which stretches suit this person, so nothing in the app suggests or starts one
// that their conditions rule out. IndyKite decides (window.api.safetyCheck, src/safety-check.js);
// the same rules run here first (indykite/rules.js) so the answer is instant and works offline.
//
//   const safety = createSafety(stretches);
//   safety.CONDITIONS               the checklist: { id, label, level } for Settings
//   safety.get()                    { conditions, cleared } they ticked
//   await safety.set(selection)     save and re-check; resolves with status()
//   safety.status()                 { allowed: count, total, source: "indykite" | "local" | "checking" }
//   safety.isAllowed(stretchId)     safety.notesFor(stretchId) -> caution notes to say first
//   safety.stretches                the stretches module, filtered (STRETCHES, stretchesFor,
//                                   startStretch refuses unsuitable ones); give this to the UI and Maizy
//   safety.onChange(cb)
//
// Only an anonymous id ("sg-<random>") and the ticked condition ids are sent, never a name or email.
import { CONDITIONS, allowedStretches } from '../indykite/rules.js';

const KEY = 'sg.health'; // { personId, conditions, cleared } in localStorage

export function createSafety(stretches) {
  let saved = load();
  let allowed = new Set(allowedStretches(saved)); // local answer until IndyKite replies
  let cautions = localCautions(saved);
  let source = 'local';
  const listeners = new Set();
  const changed = () => listeners.forEach((cb) => cb(status()));

  // Checks run strictly one at a time (a promise chain), so IndyKite's graph writes never
  // interleave. Each request gets a number; only the newest one may call IPC or apply a reply.
  let latest = 0;
  let queue = Promise.resolve();

  function check() {
    if (!globalThis.window?.api?.safetyCheck) return Promise.resolve(status()); // dev page without Electron: local rules only
    const mine = ++latest;
    source = 'checking';
    changed();
    const run = queue.then(async () => {
      if (mine !== latest) return status(); // a newer check is queued; skip this one
      const person = saved;
      try {
        const r = await window.api.safetyCheck(person);
        if (mine !== latest) return status(); // stale reply: a newer check was requested meanwhile
        allowed = new Set(r.allowed);
        cautions = r.cautions ?? {};
        source = r.source;
      } catch (err) {
        if (mine !== latest) return status();
        console.warn('[safety] check failed, using the local rules:', err);
        allowed = new Set(allowedStretches(person));
        cautions = localCautions(person);
        source = 'local';
      }
      changed();
      return status();
    });
    queue = run.catch(() => {});
    return run;
  }

  function set({ conditions = [], cleared = [] }) {
    saved = { ...saved, conditions, cleared: cleared.filter((id) => conditions.includes(id)) };
    store(saved);
    allowed = new Set(allowedStretches(saved)); // be safe straight away, before IndyKite answers
    cautions = localCautions(saved);
    changed();
    return check();
  }

  function status() {
    return { allowed: allowed.size, total: stretches.STRETCHES.length, source };
  }

  const isAllowed = (id) => allowed.has(id);
  const filtered = {
    get STRETCHES() {
      return stretches.STRETCHES.filter((s) => isAllowed(s.id));
    },
    stretchesFor: (issueId) => stretches.stretchesFor(issueId).filter((s) => isAllowed(s.id)),
    startStretch(id) {
      if (!isAllowed(id)) {
        console.warn(`[safety] not starting "${id}": their health check rules it out`);
        return false;
      }
      return stretches.startStretch(id);
    },
    stopStretch: (...args) => stretches.stopStretch(...args),
    onStretchEvent: (cb) => stretches.onStretchEvent(cb),
  };

  check();
  return {
    CONDITIONS: CONDITIONS.map(({ id, label, level }) => ({ id, label, level })),
    get: () => ({ conditions: [...saved.conditions], cleared: [...saved.cleared] }),
    set,
    status,
    isAllowed,
    notesFor: (id) => cautions[id] ?? [],
    stretches: filtered,
    onChange: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
  };
}

function localCautions(person) {
  const notes = {};
  for (const c of CONDITIONS) {
    if (c.level !== 'caution' || !person.conditions.includes(c.id)) continue;
    for (const id of c.stretches) (notes[id] ??= []).push(c.note);
  }
  return notes;
}

// localStorage can be missing or throw; then nothing is ticked and the id lasts this run only.
function load() {
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    // start fresh
  }
  const person = {
    personId: /^sg-[0-9a-f-]{36}$/.test(data.personId) ? data.personId : `sg-${crypto.randomUUID()}`,
    conditions: Array.isArray(data.conditions) ? data.conditions : [],
    cleared: Array.isArray(data.cleared) ? data.cleared : [],
  };
  store(person);
  return person;
}

function store(person) {
  try {
    localStorage.setItem(KEY, JSON.stringify(person));
  } catch {
    // not saved, only lasts this run
  }
}
