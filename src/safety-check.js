// Main process: which stretches suit this person, decided by IndyKite (indykite/ for the graph,
// rules and policy). Runs here because the IndyKite key must never reach the window.
//
//   checkSafety({ personId, conditions, cleared }) -> { allowed, cautions, source }
//     personId    anonymous random id made by the window ("sg-<uuid>"), no name or email
//     conditions  condition ids they ticked in Settings → Health check
//     cleared     the ones a clinician has cleared (only matters for "ask first" conditions)
//     allowed     stretch ids they may do
//     cautions    { stretchId: [notes Maizy should say] }
//     source      "indykite", or "local" when IndyKite couldn't be reached (same rules, rules.js)
import { CONDITIONS, allowedStretches } from '../indykite/rules.js';
import { post } from '../indykite/ik.mjs';

const KNOWN = new Set(CONDITIONS.map((c) => c.id));
const PERSON_ID = /^sg-[0-9a-f-]{36}$/;

export async function checkSafety({ personId, conditions = [], cleared = [] } = {}) {
  const person = {
    id: String(personId ?? ''),
    conditions: conditions.filter((id) => KNOWN.has(id)),
    cleared: cleared.filter((id) => KNOWN.has(id)),
  };
  const cautions = cautionNotes(person);
  if (!PERSON_ID.test(person.id)) return { allowed: allowedStretches(person), cautions, source: 'local' };

  try {
    await syncPerson(person);
    const r = await post('/access/v1/search/resource', {
      subject: { type: 'Person', id: person.id },
      action: { name: 'RECEIVE' },
      resource: { type: 'Stretch' },
    });
    if (!r.ok) throw new Error(`search ${r.status}`);
    const allowed = (r.body?.results ?? []).map((x) => x.id);
    return { allowed, cautions, source: 'indykite' };
  } catch (err) {
    console.warn('IndyKite check failed, using the local rules:', err.message ?? err);
    return { allowed: allowedStretches(person), cautions, source: 'local' };
  }
}

// Make IndyKite's graph match what they ticked: one HAS_CONDITION or CLEARED_CONDITION arrow per
// ticked condition, and no arrows for the rest (unticking removes it).
async function syncPerson(person) {
  const P = { type: 'Person', external_id: person.id };
  const arrow = (id, type) => ({ source: P, target: { type: 'Condition', external_id: id }, type });

  const keep = [];
  const remove = [];
  for (const { id } of CONDITIONS) {
    const ticked = person.conditions.includes(id);
    const isCleared = ticked && person.cleared.includes(id);
    for (const type of ['HAS_CONDITION', 'CLEARED_CONDITION']) {
      const wanted = ticked && (type === 'CLEARED_CONDITION') === isCleared;
      (wanted ? keep : remove).push(arrow(id, type));
    }
  }

  const steps = [
    ['/capture/v1/nodes', { nodes: [{ ...P, is_identity: true, properties: [{ type: 'name', value: 'stretchGoals user' }] }] }],
    ['/capture/v1/relationships/delete', { relationships: remove }],
    ...(keep.length ? [['/capture/v1/relationships', { relationships: keep }]] : []),
  ];
  for (const [path, body] of steps) {
    const r = await post(path, body);
    if (!r.ok) throw new Error(`${path} ${r.status}`);
  }
}

// The "caution" notes that apply to each stretch, for Maizy to say before starting it.
function cautionNotes(person) {
  const notes = {};
  for (const c of CONDITIONS) {
    if (c.level !== 'caution' || !person.conditions.includes(c.id)) continue;
    for (const stretchId of c.stretches) (notes[stretchId] ??= []).push(c.note);
  }
  return notes;
}
