// Everything the voice coach says on its own (outside a Maizy conversation).
// Owner: Joseph (Track 3).
//
// Each line ID has 2–4 versions, so she doesn't sound like a robot. getLine(id) picks one at random.
// Line IDs look like "nudge.forward_head" or "stretch.switch_sides".
//
// Writing for the ear (eleven_v4_turbo):
//   - short sentences, one idea each
//   - "…" for a natural pause
//   - plain words only, no medical terms (the screen can still show the medical name)
//   - numbers as words ("five", not "5")
//   - kind, never shaming

export const LINES = {
  // ---------------------------------------------------------------------------
  // Nudges: a posture issue has been going on for a while (sustained)
  // ---------------------------------------------------------------------------
  "nudge.forward_head": [
    "Heads up… your neck's drifted forward. Try tucking your chin back.",
    "Quick check… your head's creeping toward the screen. Slide your chin straight back.",
    "Your neck's a little too far out… sit tall, and bring your ears back over your shoulders.",
    "Little reminder… glide your chin back, like closing a drawer.",
  ],
  "nudge.slouching": [
    "Heads up… you're hunching over a bit. Roll your shoulders back and sit tall.",
    "Quick check… you're starting to slouch. Lift your chest, and let your shoulders drop back.",
    "You're curling forward a little… sit up tall, like a string is pulling the top of your head.",
    "Little reminder… you're hunched over. Shoulders back, chest proud.",
  ],
  "nudge.head_tilt": [
    "Heads up… your head's tilted to one side. Bring it back to the middle.",
    "Quick check… your head's leaning to one side. Level your ears.",
    "Your head's tipped over a little… straighten up, and keep your eyes level.",
  ],
  "nudge.uneven_shoulders": [
    "Heads up… one shoulder's higher than the other. Let them both relax down.",
    "Quick check… one shoulder's creeping up. Drop both shoulders, and let them hang evenly.",
    "Your shoulders are uneven… take a breath, and let them both sink down.",
  ],
  "nudge.too_close": [
    "Heads up… you're leaning in toward the screen. Ease back a little.",
    "Quick check… you're getting close to the screen. Sit back in your chair.",
    "You're drifting toward the screen… lean back, and give your eyes some room.",
  ],

  // ---------------------------------------------------------------------------
  // Offer a stretch after a nudge, if the issue keeps going
  // ---------------------------------------------------------------------------
  "offer.stretch": [
    "Want to try a quick stretch? It only takes about thirty seconds.",
    "Shall we do a short stretch for that? Half a minute, tops.",
    "How about a quick stretch to reset? I'll walk you through it.",
  ],

  // ---------------------------------------------------------------------------
  // Praise: an issue we nudged about has gone away
  // ---------------------------------------------------------------------------
  "praise.fixed": [
    "Nice… that's much better.",
    "There you go. Sitting tall again.",
    "Lovely, that's it. Your score's climbing back up.",
    "Great fix. Keep it up.",
  ],

  // ---------------------------------------------------------------------------
  // Calibration: recording the user's "sitting tall" posture
  // ---------------------------------------------------------------------------
  "calibration.start": [
    "Let's get your best posture. Sit up nice and tall, and look at the screen.",
    "Time to calibrate. Sit tall and comfortable, and look straight ahead.",
  ],
  "calibration.hold": [
    "Hold it… three… two… one.",
    "Stay just like that… three… two… one.",
  ],
  "calibration.done": [
    "Got it! That's your baseline. I'll keep an eye on things from here.",
    "Perfect, all set. I'll let you know if you drift.",
  ],
  "calibration.failed": [
    "Hmm, I couldn't quite see you. Make sure your head and shoulders are in view, and let's try again.",
    "That didn't work. Try sitting still, with your shoulders in the frame, and we'll go again.",
  ],

  // ---------------------------------------------------------------------------
  // Stretches: around the steps (the steps themselves come from src/stretches)
  // ---------------------------------------------------------------------------
  "stretch.intro": [
    "Okay, let's do this together. Move gently, and stop if anything hurts.",
    "Here we go. Nice and gentle… only as far as feels comfortable.",
  ],
  "stretch.switch_sides": [
    "Nice. Now switch sides.",
    "Good. Same thing on the other side.",
  ],
  "stretch.relax": [
    "And relax.",
    "Let it go… and relax.",
  ],
  "stretch.done": [
    "All done! How does that feel?",
    "And that's it. Nicely done.",
    "Finished. Your neck and shoulders will thank you.",
  ],
  "stretch.stopped": [
    "No problem, we'll stop there.",
    "Okay, stopping. Take it easy.",
  ],

  // ---------------------------------------------------------------------------
  // Countdown for holds
  // ---------------------------------------------------------------------------
  "countdown.five": ["Five… four… three… two… one."],
  "countdown.three": ["Three… two… one."],

  // ---------------------------------------------------------------------------
  // General
  // ---------------------------------------------------------------------------
  "welcome": [
    "Hi, I'm Maizy. I'll keep an eye on your posture while you work.",
    "Hey, Maizy here. Let's keep you sitting comfortably today.",
  ],
  "break.reminder": [
    "You've been sitting a while. Fancy a quick stretch break?",
    "Time for a little movement? A thirty second stretch can really help.",
  ],
};

/** Every line ID, e.g. for a dev page that plays each one. */
export const LINE_IDS = Object.freeze(Object.keys(LINES));

const lastPicked = {}; // lineId -> index used last time, so the same version doesn't play twice in a row

/** One version of a line, picked at random (never the same one twice in a row). Returns null for an unknown ID. */
export function getLine(lineId) {
  const versions = LINES[lineId];
  if (!versions) return null;
  let i = Math.floor(Math.random() * versions.length);
  if (versions.length > 1 && i === lastPicked[lineId]) i = (i + 1) % versions.length;
  lastPicked[lineId] = i;
  return versions[i];
}
