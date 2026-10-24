// TEMPORARY copy of src/ui/fallback-stretches.js (darren branch) so the agent test page works today.
// Replace with Joseph's real src/stretches/index.js once it exists (same shape and functions).

export const FALLBACK_STRETCHES = [
  {
    id: "chin_tuck",
    name: "Chin tucks",
    helps: ["forward_head"],
    how: "Sit tall and slide your chin straight back, like making a double chin.",
    steps: [
      { text: "Sit tall and look straight ahead.", seconds: 5 },
      { text: "Slide your chin straight back, like making a double chin. Hold it.", seconds: 5 },
      { text: "Let go, then tuck again. Slow and gentle, a few more times.", seconds: 20 },
    ],
  },
  {
    id: "upper_trap",
    name: "Ear-to-shoulder stretch",
    helps: ["head_tilt"],
    how: "Tip one ear toward your shoulder and hold, then switch sides.",
    steps: [
      { text: "Tip your right ear toward your right shoulder. Keep your shoulders down.", seconds: 20 },
      { text: "Come back to the middle, then tip your left ear toward your left shoulder.", seconds: 20 },
    ],
  },
  {
    id: "levator",
    name: "Look-to-armpit stretch",
    helps: [],
    how: "Turn your nose toward your armpit and look down, then switch sides.",
    steps: [
      { text: "Turn your nose toward your right armpit and look down.", seconds: 20 },
      { text: "Now turn toward your left armpit and look down.", seconds: 20 },
    ],
  },
  {
    id: "chest_opener",
    name: "Seated chest opener",
    helps: ["slouching"],
    how: "Clasp your hands behind your back, squeeze your shoulder blades and lift your chest.",
    steps: [
      { text: "Clasp your hands behind your back.", seconds: 5 },
      { text: "Squeeze your shoulder blades together and lift your chest. Hold.", seconds: 20 },
    ],
  },
  {
    id: "scap_squeeze",
    name: "Shoulder blade squeeze",
    helps: ["slouching", "uneven_shoulders"],
    how: "Squeeze your shoulder blades together and down, hold, then relax.",
    steps: [
      { text: "Squeeze your shoulder blades together and down. Hold.", seconds: 5 },
      { text: "Relax, then squeeze again. Keep going at your own pace.", seconds: 25 },
    ],
  },
  {
    id: "shoulder_rolls",
    name: "Shoulder rolls",
    helps: ["uneven_shoulders"],
    how: "Roll your shoulders slowly backward, ten times.",
    steps: [
      { text: "Lift your shoulders up toward your ears.", seconds: 5 },
      { text: "Roll them back and down, slowly. Keep rolling.", seconds: 25 },
    ],
  },
  {
    id: "seated_extension",
    name: "Seated back extension",
    helps: ["slouching"],
    how: "Hands behind your head, gently arch back over the top of your chair.",
    steps: [
      { text: "Put your hands behind your head.", seconds: 5 },
      { text: "Gently arch back over the top of your chair. Hold, then sit up.", seconds: 25 },
    ],
  },
  {
    id: "eye_break",
    name: "20-20-20 break",
    helps: ["too_close"],
    how: "Sit back and look at something about 20 feet away for 20 seconds.",
    steps: [
      { text: "Sit back in your chair.", seconds: 5 },
      { text: "Look at something about 20 feet (6 m) away. Let your eyes relax.", seconds: 20 },
    ],
  },
];

/**
 * A stand-in for Joseph's stretches module: same functions, no voice.
 * It walks through the steps with a 1-second timer and sends the same
 * stretch events: { type: "start" | "step" | "tick" | "end", stretchId, stepIndex, secondsLeft }
 */
export function createFallbackStretches() {
  const listeners = new Set();
  let timer = null;
  let currentId = null;

  const emit = (event) => listeners.forEach((cb) => cb(event));

  function stopTimer() {
    clearInterval(timer);
    timer = null;
  }

  return {
    STRETCHES: FALLBACK_STRETCHES,

    stretchesFor(issueId) {
      return FALLBACK_STRETCHES.filter((s) => s.helps.includes(issueId));
    },

    onStretchEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    startStretch(id) {
      const stretch = FALLBACK_STRETCHES.find((s) => s.id === id);
      if (!stretch) return;
      stopTimer();
      currentId = id;
      let stepIndex = 0;
      let secondsLeft = stretch.steps[0].seconds;
      emit({ type: "start", stretchId: id, stepIndex, secondsLeft });

      timer = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
          emit({ type: "tick", stretchId: id, stepIndex, secondsLeft });
          return;
        }
        stepIndex += 1;
        if (stepIndex >= stretch.steps.length) {
          // Last step finished
          stopTimer();
          currentId = null;
          emit({ type: "end", stretchId: id, stepIndex: stepIndex - 1, secondsLeft: 0 });
          return;
        }
        secondsLeft = stretch.steps[stepIndex].seconds;
        emit({ type: "step", stretchId: id, stepIndex, secondsLeft });
      }, 1000);
    },

    stopStretch() {
      if (!currentId) return;
      const id = currentId;
      stopTimer();
      currentId = null;
      emit({ type: "end", stretchId: id, stepIndex: 0, secondsLeft: 0 });
    },
  };
}
