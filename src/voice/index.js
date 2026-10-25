// Exports (TEAM_GUIDE 3.4):
//   voiceCoach.update(state)        call ~10x a second with Darren's PostureState
//   voiceCoach.setMuted(bool)       the voice on/off switch in settings
//   voiceCoach.setAgentActive(bool) true while a Maizy conversation is open, so only one voice talks
//   speakLine(lineId)               say one line from lines.js, e.g. speakLine("praise.fixed")
import { getLine } from "./lines.js";
import { STRETCHES, onStretchEvent } from "../stretches/index.js";
let muted = false;
let agentActive = false;
let queue = Promise.resolve(); // lines wait here so two never play at once
let queued = 0; // how many lines are waiting or playing
let currentAudio = null;
let generation = 0; // goes up on every silence(), so lines queued before it are skipped

// On a dev page without Electron, it asks the local dev server instead.
async function textToMp3(text) {
  if (globalThis.window?.api?.tts) return window.api.tts(text);
  const res = await fetch("/tts", { method: "POST", body: text });
  if (!res.ok) throw new Error(`tts failed: ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Play mp3 bytes and wait until they finish.
function play(bytes) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    currentAudio = new Audio(url);
    const done = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolve();
    };
    currentAudio.onended = done;
    currentAudio.onerror = done;
    currentAudio.play().catch(done); // browsers block audio until the user has clicked something
  });
}

/** Say some text. Waits its turn behind anything already playing. */
function say(text) {
  if (muted || agentActive) return Promise.resolve();
  queued += 1;
  const myGeneration = generation;
  const turn = queue.then(async () => {
    try {
      if (muted || agentActive || myGeneration !== generation) return; // could have changed while we waited
      onSpeak?.(text);
      await play(await textToMp3(text));
    } catch (err) {
      console.warn("[voice]", err.message ?? err);
    } finally {
      queued -= 1;
    }
  });
  queue = turn;
  return turn;
}

/** Stop talking right now and forget anything waiting. */
function silence() {
  generation += 1;
  currentAudio?.pause();
  currentAudio = null;
}

/** Say one line from lines.js. Resolves when it has finished playing. */
export function speakLine(lineId) {
  const text = getLine(lineId);
  if (!text) return Promise.reject(new Error(`Unknown line: ${lineId}`));
  return say(text);
}

/** True while a line is playing or waiting to play. */
export const isSpeaking = () => queued > 0;

// For dev pages and tests: get told every time a line starts (text).
let onSpeak = null;
export function onSpeech(cb) {
  onSpeak = cb;
}

export const RULES = {
    sameIssueMs: 3 * 60_000, // wait 3 minutes before nudging about the same issue again
    anyLineMs: 60_000, // and at least 60 seconds between any two nudges
    offerAfterMs: 60_000, // still not fixed a minute after a nudge? offer a stretch (once)
  };
  
  const lastNudgedAt = {}; // issueId -> when we last nudged about it
  let lastLineAt = -Infinity;
  let warned = null; // { id, at, offered } for the issue we nudged about, so we can praise or offer a stretch
  let wasCalibrating = false;
  let stretching = false; // set in step 3
  
  /**
   * Look at the latest PostureState and decide whether to say something.
   * `now` is only there so tests can fake the clock.
   */
  function update(state, now = Date.now()) {
    // Calibration: talk the person through it, and say nothing else meanwhile
    if (state.calibrating && !wasCalibrating) speakLine("calibration.start");
    if (!state.calibrating && wasCalibrating) speakLine(state.calibrated ? "calibration.done" : "calibration.failed");
    wasCalibrating = state.calibrating;
    if (state.calibrating) return;
  
    // Nothing to judge yet, or a stretch is running (its own guidance plays instead)
    if (!state.present || !state.calibrated || stretching) return;
    if (muted || agentActive || isSpeaking()) return;
  
    const issue = state.issues.find((i) => i.sustained); // issues come worst first
  
    // 1. The issue we nudged about is gone: praise straight away
    if (warned && !state.issues.some((i) => i.id === warned.id)) {
      warned = null;
      lastLineAt = now;
      speakLine("praise.fixed");
      return;
    }
  
    if (now - lastLineAt < RULES.anyLineMs) return;
  
    // 2. Same issue still going a minute after the nudge: offer a stretch, once
    if (warned && issue?.id === warned.id && !warned.offered && now - warned.at >= RULES.offerAfterMs) {
      warned.offered = true;
      lastLineAt = now;
      speakLine("offer.stretch");
      return;
    }
  
    // 3. A sustained issue we haven't nudged about recently: nudge
    if (issue && now - (lastNudgedAt[issue.id] ?? -Infinity) >= RULES.sameIssueMs) {
      lastNudgedAt[issue.id] = now;
      lastLineAt = now;
      warned = { id: issue.id, at: now, offered: false };
      speakLine(`nudge.${issue.id}`);
    }
  }


let lastSecondsLeft = 0;

onStretchEvent((e) => {
  const stretch = STRETCHES.find((s) => s.id === e.stretchId);
  const step = stretch.steps[e.stepIndex];

  if (e.type === "start") {
    stretching = true;
    warned = null; // the stretch is the fix, so no praise line needed afterwards
    speakLine("stretch.intro");
    say(step.text);
  }

  if (e.type === "step") say(step.text);

  // Count down the last three seconds of longer holds
  if (e.type === "tick" && e.secondsLeft === 3 && step.seconds >= 10) speakLine("countdown.three");

  if (e.type === "end") {
    stretching = false;
    // Finished on its own = last step ran down to its final second. Anything else = stopped early.
    const finished = e.stepIndex === stretch.steps.length - 1 && lastSecondsLeft <= 1;
    speakLine(finished ? "stretch.done" : "stretch.stopped");
  }

  lastSecondsLeft = e.secondsLeft;
});

/** The voice on/off switch. Muting also stops whatever is playing. */
function setMuted(value) {
    muted = Boolean(value);
    if (muted) silence();
  }
  
  /**
   * Call with true when a Maizy conversation starts and false when it ends.
   * Only one voice talks at a time: while Maizy is on, she handles nudges and stretches herself.
   */
  function setAgentActive(value) {
    agentActive = Boolean(value);
    if (agentActive) silence();
  }
  
  export const voiceCoach = { update, setMuted, setAgentActive };