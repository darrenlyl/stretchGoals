// Guided stretches (owner: Joseph, Track 3).
//
// What's in here:
//   STRETCHES           the data: every stretch, which issues it helps, and its timed steps
//   stretchesFor(id)    the stretches that help one posture issue
//   startStretch(id)    walks through the steps on a 1-second timer and sends events
//   stopStretch()       stops early
//   onStretchEvent(cb)  listen to events: { type: "start" | "step" | "tick" | "end", stretchId, stepIndex, secondsLeft }
//
// This module has no voice and no screen. It only keeps time and sends events.
// The UI, Maizy and the voice coach listen to the events and each do their own part.
// Shape matches TEAM_GUIDE.md 3.4 and Darren's src/ui/fallback-stretches.js, so the UI works with it as-is.
//
// Keep stretches gentle, seated, and 30–60 seconds long (TEAM_GUIDE Track 3).

/**
 * @typedef {Object} StretchStep
 * @property {string} text     what to do, said out loud and shown on screen
 * @property {number} seconds  how long this step lasts
 *
 * @typedef {Object} Stretch
 * @property {string} id
 * @property {string} name
 * @property {string[]} helps  issue IDs from src/shared/contracts.js
 * @property {string} how      one-sentence summary
 * @property {string} cue      a short, vivid line Maizy can say ("like closing a drawer")
 * @property {number} reps     how many times you do the main move
 * @property {boolean} bothSides  true if you do it on the left and the right
 * @property {string|null} cautionNote  a safety tip for this stretch, said when relevant
 * @property {{ name: string, url: string }} source  where the stretch comes from. Only mention it if someone asks.
 * @property {StretchStep[]} steps
 */

/** @type {Stretch[]} */
export const STRETCHES = [
  {
    id: "chin_tuck",
    name: "Chin tucks",
    helps: ["forward_head"],
    how: "Sit tall and slide your chin straight back, like making a double chin.",
    cue: "Glide your chin straight back, like closing a drawer.",
    reps: 6,
    bothSides: false,
    cautionNote: "Move slowly, only as far as is comfortable. Stop if you feel tingling or numbness in your arm.",
    source: { name: "NHS North Cheshire & Mersey: neck range of motion exercises", url: "https://northcheshireandmersey.nhs.uk/media/emlfdohl/neck-range-of-motion-exercises-patient-advice-sheet.pdf" },
    steps: [
      { text: "Sit tall and look straight ahead.", seconds: 5 },
      { text: "Slide your chin straight back, like making a double chin. Hold.", seconds: 5 },
      { text: "Relax, then tuck again. Five seconds each time, slow and gentle.", seconds: 25 },
    ],
  },
  {
    id: "upper_trap",
    name: "Ear-to-shoulder stretch",
    helps: ["head_tilt"],
    how: "Tip one ear toward your shoulder and hold, then switch sides.",
    cue: "Let your ear drift toward your shoulder, and keep the other shoulder heavy.",
    reps: 1,
    bothSides: true,
    cautionNote: "Tilt gently to a mild stretch only. No bouncing.",
    source: { name: "Mayo Clinic: neck stretches", url: "https://www.mayoclinic.org/health/neck-stretches/MM00708" },
    steps: [
      { text: "Tip your right ear toward your right shoulder. Keep both shoulders down.", seconds: 20 },
      { text: "Come back to the middle, then tip your left ear toward your left shoulder.", seconds: 20 },
    ],
  },
  {
    id: "levator",
    name: "Look-to-armpit stretch",
    helps: [], // general neck tension, not tied to one issue
    how: "Turn your nose toward your armpit and look down, then switch sides.",
    cue: "Nose toward your armpit, then let the weight of your head do the work.",
    reps: 1,
    bothSides: true,
    cautionNote: "Go gently, and stop if you feel dizzy or any tingling.",
    source: { name: "ColumbiaDoctors health library: levator scapula stretch", url: "https://www.columbiadoctors.org/health-library/multimedia/levator-scapula-stretch-1/" },
    steps: [
      { text: "Turn your nose toward your right armpit and gently look down.", seconds: 20 },
      { text: "Come back up, then turn toward your left armpit and look down.", seconds: 20 },
    ],
  },
  {
    id: "chest_opener",
    name: "Seated chest opener",
    helps: ["slouching"],
    how: "Clasp your hands behind your back, squeeze your shoulder blades and lift your chest.",
    cue: "Hands clasped behind you, chest proud, shoulder blades together.",
    reps: 1,
    bothSides: false,
    cautionNote: "Only lift your arms as far as your shoulders are comfortable.",
    source: { name: "Mayo Clinic: shoulder and chest stretches", url: "https://www.mayoclinic.org/healthy-lifestyle/adult-health/multimedia/shoulder-stretches/vid-20084699" },
    steps: [
      { text: "Clasp your hands behind your back.", seconds: 5 },
      { text: "Squeeze your shoulder blades together and lift your chest. Hold.", seconds: 25 },
    ],
  },
  {
    id: "scap_squeeze",
    name: "Shoulder blade squeeze",
    helps: ["slouching", "uneven_shoulders"],
    how: "Squeeze your shoulder blades together and down, hold, then relax.",
    cue: "Squeeze your shoulder blades together, like holding a pencil between them.",
    reps: 5,
    bothSides: false,
    cautionNote: "Squeeze gently. It shouldn't pinch.",
    source: { name: "Mayo Clinic: shoulder and chest stretches", url: "https://www.mayoclinic.org/healthy-lifestyle/adult-health/multimedia/shoulder-stretches/vid-20084699" },
    steps: [
      { text: "Squeeze your shoulder blades together and down. Hold.", seconds: 5 },
      { text: "Relax, then squeeze again. Five seconds each, at your own pace.", seconds: 25 },
    ],
  },
  {
    id: "shoulder_rolls",
    name: "Shoulder rolls",
    helps: ["uneven_shoulders"],
    how: "Roll your shoulders slowly backward, ten times.",
    cue: "Up toward your ears, back, and down. Slow, smooth circles.",
    reps: 10,
    bothSides: false,
    cautionNote: "Keep the circles slow and stay in a pain-free range.",
    source: { name: "NHS Wrightington, Wigan & Leigh: neck and upper back exercises, level 1", url: "https://www.wwl.nhs.uk/pdfreader/cnv-wwl-68ca8bce9edd73.73954624" },
    steps: [
      { text: "Lift your shoulders up toward your ears.", seconds: 5 },
      { text: "Roll them back and down, slowly. Keep rolling, about ten times.", seconds: 25 },
    ],
  },
  {
    id: "seated_extension",
    name: "Seated back extension",
    helps: ["slouching"],
    how: "Hands behind your head, gently arch back over the top of your chair.",
    cue: "Hands behind your head, and gently lean your upper back over the chair.",
    reps: 3,
    bothSides: false,
    cautionNote: "Use a sturdy chair, and keep the movement small and comfortable.",
    source: { name: "Cambridge University Hospitals NHS: thoracic spine exercises", url: "https://www.cuh.nhs.uk/patient-information/thoracic-spine-exercises/" },
    steps: [
      { text: "Put your hands behind your head.", seconds: 5 },
      { text: "Gently arch back over the top of your chair. Hold, then sit up. Repeat slowly.", seconds: 25 },
    ],
  },
  {
    id: "eye_break",
    name: "20-20-20 break",
    helps: ["too_close"],
    how: "Sit back and look at something about 20 feet away for 20 seconds.",
    cue: "Look at something far away, and let your eyes go soft.",
    reps: 1,
    bothSides: false,
    cautionNote: null,
    source: { name: "American Academy of Ophthalmology: computers, digital devices and eye strain", url: "https://www.aao.org/eye-health/tips-prevention/computer-usage" },
    steps: [
      { text: "Sit back in your chair and let your shoulders drop.", seconds: 10 },
      { text: "Look at something about 20 feet (6 m) away. Let your eyes relax.", seconds: 20 },
    ],
  },
];

/** The stretches that help one issue, e.g. stretchesFor("slouching"). */
export function stretchesFor(issueId) {
  return STRETCHES.filter((s) => s.helps.includes(issueId));
}

// ---------------------------------------------------------------------------
// The guided timer
// ---------------------------------------------------------------------------

const listeners = new Set();
let timer = null;
let current = null; // { stretch, stepIndex, secondsLeft } while a stretch is running

function emit(type) {
  const event = {
    type,
    stretchId: current.stretch.id,
    stepIndex: current.stepIndex,
    secondsLeft: current.secondsLeft,
  };
  listeners.forEach((cb) => cb(event));
}

/** Listen to stretch events. Returns a function that stops listening. */
export function onStretchEvent(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Start a stretch by id. Starting a new one stops the old one first. Returns false for an unknown id. */
export function startStretch(id) {
  const stretch = STRETCHES.find((s) => s.id === id);
  if (!stretch) return false;
  stopStretch();

  current = { stretch, stepIndex: 0, secondsLeft: stretch.steps[0].seconds };
  emit("start");

  // setInterval, not requestAnimationFrame: it keeps running when the window is hidden.
  timer = setInterval(() => {
    current.secondsLeft -= 1;
    if (current.secondsLeft > 0) return emit("tick");

    // This step is done. Move to the next one, or finish.
    current.stepIndex += 1;
    if (current.stepIndex >= stretch.steps.length) {
      current.stepIndex -= 1;
      finish();
      return;
    }
    current.secondsLeft = stretch.steps[current.stepIndex].seconds;
    emit("step");
  }, 1000);
  return true;
}

/** Stop the running stretch early (if any). Sends an "end" event. */
export function stopStretch() {
  if (current) finish();
}

function finish() {
  clearInterval(timer);
  timer = null;
  current.secondsLeft = 0;
  emit("end");
  current = null;
}
