// Maizy, the live voice agent. Used by the real app (src/app.js) and the test page (agent-dev.js).
// She is NOT always on, because calls are billed per minute. A call starts when:
//   - someone says "Hey Maizy" or presses Talk (start("wake_word") / start("talk")), or
//   - the app decides a moment is worth it (WAKE_RULES, checked in update()).
// A call ends when they say goodbye, after CALL_RULES.quietHangUpSec of silence, or at the
// 5-minute cap set in maizy-config.mjs.
//
//   const agent = createMaizyAgent({ Conversation, getSignedUrl, controls, safety, onLog });
//   agent.update(state)       every PostureState (~10 times a second)
//   agent.start(reason, { heardAt })  "wake_word" | "talk"; heardAt = when "Hey Maizy" was heard, for timing
//   agent.warmUp()            keep a signed URL ready so calls start faster (free)
//   agent.end()
//   agent.setAutoWake(bool)   false = never wake by herself (voice off, paused)
//   agent.onChange(cb)        cb({ status, reason }), status: "idle" | "connecting" | "talking"
//   agent.status()
//
// Conversation is the class from @elevenlabs/client, passed in so the app can use the npm
// package and the test page a CDN copy. getSignedUrl() returns a URL from ElevenLabs.
// controls (app-controls.js) lets her press the app's buttons when asked; leave it out where there are none.
// safety (src/safety.js) limits her to stretches that suit their health check, with caution notes.
import { ISSUES } from "../../shared/contracts.js";
import * as stretches from "../../stretches/index.js";

// When the app wakes her up by itself. Placeholder values: the team still has to decide these.
export const WAKE_RULES = {
  stuckIssueSec: 240, // a sustained issue still going after 4 min (the coach has nudged and offered a stretch by then)
  stuckMinSeverity: 0.5, // ...and it's at least medium-bad
  longSitMin: 50, // sitting this long without a break
  breakMin: 5, // out of frame this long counts as a break
  minGapMin: 20, // at most one wake-up every 20 minutes
  maxPerDay: 6,
};

// Keeping calls short, and what she's told during a call.
export const CALL_RULES = {
  quietHangUpSec: 30, // nobody has spoken for this long: she says goodbye and hangs up
  goodbyeGraceSec: 8, // time for her goodbye before we hang up ourselves
  sameIssueMs: 180_000, // during a call: 3 min before mentioning the same issue again
  anyLineMs: 60_000, // and 60 s between posture updates
};

const AUTO_REASONS = new Set(["stuck_issue", "long_sitting"]);

// They're wrapping up: "bye Maizy", "goodbye", "see you", "that's all", "I'm done", "talk later".
export const GOODBYE_PATTERN =
  /\b(bye|goodbye|good bye|bye-bye|see (you|ya)|talk (to you )?later|that'?s all|i'?m done|that'?ll be all|good ?night)\b/i;

// What she says first when they called her ("Hey Maizy" or Talk). Spoken straight away.
const GREETINGS = ["Hey!", "Yes?", "What's up?", "I'm here."];

// The daily cap survives restarts when localStorage works, and lives in memory when it doesn't.
const WAKES_KEY = "maizy.autoWakes";
let memoryWakes = { day: "", count: 0 };
const today = () => new Date().toDateString();
function readWakes() {
  try {
    return JSON.parse(localStorage.getItem(WAKES_KEY)) ?? memoryWakes;
  } catch {
    return memoryWakes;
  }
}
function autoWakesToday() {
  const w = readWakes();
  return w.day === today() ? w.count : 0;
}
function countAutoWake() {
  memoryWakes = { day: today(), count: autoWakesToday() + 1 };
  try {
    localStorage.setItem(WAKES_KEY, JSON.stringify(memoryWakes));
  } catch {
    // private mode or no storage: the in-memory count still works for this run
  }
}

export function createMaizyAgent({ Conversation, getSignedUrl, controls = null, safety = null, onLog = () => {} }) {
  const allowedStretches = safety?.stretches ?? stretches; // filtered by their health check when there is one
  let conversation = null;
  let status = "idle";
  let reason = null;
  let mode = "listening"; // "speaking" while she talks
  let endRequested = false;
  let autoWake = true;
  let latest = null; // last PostureState
  const listeners = new Set();

  // Call bookkeeping
  let lastActivityAt = 0;
  let goodbyeAt = 0; // when the call started winding down (they said bye, or went quiet)
  let saidGoodbye = false; // she has spoken since then
  let quietTimer = null;
  const lastToldAt = {}; // issueId -> when she was last told about it
  let lastAppLineAt = 0;
  let toldIssue = null; // the issue she was told about, so she can praise when it's gone

  // Wake-up bookkeeping
  let stretchRunning = false;
  let sitStartedAt = null;
  let lastSeenAt = 0;
  let lastAutoWakeAt = -Infinity;

  function setStatus(next) {
    status = next;
    if (next === "idle") reason = null;
    for (const cb of listeners) cb({ status, reason });
  }

  // ---------------------------------------------------------------------------
  // Starting and ending calls
  // ---------------------------------------------------------------------------

  // Signed URLs last about 15 minutes. Keeping a spare one saves a round trip when they say "Hey Maizy".
  const SPARE_URL_MAX_AGE_MS = 10 * 60_000;
  let spareUrl = null; // { url, at }
  let warmTimer = null;

  /** Keep a signed URL ready (refreshed every 10 min) so a call starts faster. Free: no call is opened. */
  function warmUp() {
    warmTimer ??= setInterval(warmUp, SPARE_URL_MAX_AGE_MS);
    if (spareUrl && Date.now() - spareUrl.at < SPARE_URL_MAX_AGE_MS) return;
    getSignedUrl().then(
      (url) => (spareUrl = { url, at: Date.now() }),
      () => {}, // no spare this time; start() fetches one itself
    );
  }

  async function takeSignedUrl() {
    const spare = spareUrl;
    spareUrl = null;
    if (warmTimer) setTimeout(warmUp, 0); // a fresh spare for the next call
    return spare && Date.now() - spare.at < SPARE_URL_MAX_AGE_MS ? spare.url : getSignedUrl();
  }

  async function start(why, detail = {}) {
    if (status !== "idle") return;
    const askedAt = detail.heardAt ?? Date.now();
    reason = why;
    endRequested = false;
    if (AUTO_REASONS.has(why)) countAutoWake();
    setStatus("connecting"); // the wake-word listener lets go of the mic on this

    // When they called her, she answers with a ready-made line: no waiting for the AI to write one.
    const greeting = AUTO_REASONS.has(why) ? null : GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
    let answered = false;

    try {
      const signedUrl = await takeSignedUrl();
      conversation = await Conversation.startSession({
        signedUrl,
        connectionType: "websocket",
        clientTools,
        ...(greeting && { overrides: { agent: { firstMessage: greeting } } }),
        onDisconnect: () => {
          conversation = null;
          clearInterval(quietTimer);
          onLog("app", "Call ended");
          setStatus("idle");
        },
        onModeChange: ({ mode: m }) => {
          mode = m;
          lastActivityAt = Date.now();
          if (m === "speaking" && !answered) {
            answered = true;
            onLog("app", `She answered ${((Date.now() - askedAt) / 1000).toFixed(1)} s after the ${why === "wake_word" ? "wake word" : "start"}`);
          }
          // Saying goodbye: hang up as soon as she has finished her own goodbye
          if (goodbyeAt && m === "speaking") saidGoodbye = true;
          if (goodbyeAt && m === "listening" && saidGoodbye) end();
        },
        onMessage: ({ message, role, source }) => {
          lastActivityAt = Date.now();
          if (message.startsWith("[app]")) return; // already logged by tell()
          const fromUser = (role ?? source) === "user";
          onLog(fromUser ? "you" : "maizy", message);
          // "Bye Maizy", "goodbye", "that's all"...: she says a short goodbye, then the call ends
          // and the app goes back to listening for "Hey Maizy". Backs up her own end_call tool.
          if (fromUser && !goodbyeAt && GOODBYE_PATTERN.test(message)) {
            goodbyeAt = Date.now();
            saidGoodbye = false;
            onLog("app", "Heard goodbye: ending the call after her reply");
          }
        },
        onError: (err) => onLog("err", String(err?.message ?? err)),
      });
    } catch (err) {
      onLog("err", `Couldn't start a call: ${err?.message ?? err}`);
      conversation = null;
      setStatus("idle");
      return;
    }

    if (endRequested) return conversation.endSession(); // end() was pressed while connecting
    onLog("app", `Call started (${why})`);
    lastActivityAt = Date.now();
    goodbyeAt = 0;
    saidGoodbye = false;
    toldIssue = null;
    setStatus("talking");
    if (!greeting) tell(openingLine(why, detail));
    if (detail.issue) {
      lastToldAt[detail.issue.id] = Date.now();
      toldIssue = detail.issue.id;
    }
    quietTimer = setInterval(checkQuiet, 1000);
  }

  function end() {
    endRequested = true;
    conversation?.endSession();
  }

  // Why the app woke her, as her first "[app]" message. Her prompt says how to open.
  function openingLine(why, d) {
    if (why === "stuck_issue") {
      const minutes = Math.max(1, Math.round(d.issue.durationSec / 60));
      return (
        `[app] The app woke you: ${d.issue.layman.toLowerCase()} for about ${minutes} minutes, ` +
        `and the quick reminder didn't fix it. Score is ${d.score}.`
      );
    }
    return `[app] The app woke you: they've been sitting for about ${d.minutes} minutes without a break.`;
  }

  // sendUserMessage makes her take a turn. Her prompt says "[app]" messages come from the app.
  function tell(text) {
    if (!conversation) return;
    lastAppLineAt = lastActivityAt = Date.now();
    conversation.sendUserMessage(text);
    onLog("app", text);
  }

  // Nobody has said anything for a while: ask her to say goodbye, then make sure the call ends.
  function checkQuiet() {
    const now = Date.now();
    if (goodbyeAt) {
      // Normally she hangs up (or onModeChange does) right after her goodbye. This is the backstop,
      // never cutting her off mid-sentence unless she runs twice as long.
      const waited = (now - goodbyeAt) / 1000;
      if ((waited > CALL_RULES.goodbyeGraceSec && mode !== "speaking") || waited > CALL_RULES.goodbyeGraceSec * 2) end();
      return;
    }
    if (mode === "speaking" || stretchRunning) lastActivityAt = now; // a guided stretch is quiet on purpose
    if (now - lastActivityAt < CALL_RULES.quietHangUpSec * 1000) return;
    tell("[app] They've gone quiet. Say a very short goodbye, then end the call.");
    goodbyeAt = now;
    saidGoodbye = false;
  }

  // ---------------------------------------------------------------------------
  // Her tools. Names must match TOOLS in maizy-config.mjs exactly.
  // ---------------------------------------------------------------------------

  const clientTools = {
    get_posture_snapshot: () => {
      onLog("tool", "get_posture_snapshot");
      const s = latest;
      if (!s) return JSON.stringify({ available: false });
      return JSON.stringify({
        present: s.present,
        calibrated: s.calibrated,
        score: s.score,
        issues: s.issues.map((i) => ({ id: i.id, plain: i.layman, severity: i.severity, seconds: i.durationSec })),
      });
    },

    get_stretches: ({ issue_id } = {}) => {
      onLog("tool", `get_stretches ${issue_id ?? ""}`);
      // Only stretches that suit their health check; safetyNote = what their conditions say to watch for
      const list = issue_id ? allowedStretches.stretchesFor(issue_id) : allowedStretches.STRETCHES;
      if (!list.length) return JSON.stringify({ stretches: [], reason: "None suit their health check right now. Don't suggest one; say a clinician can advise." });
      return JSON.stringify(
        list.map(({ id, name, how, cue, reps, bothSides, cautionNote, helps, source }) => ({
          id, name, how, cue, reps, bothSides, cautionNote, helps, source: source.name,
          ...(safety?.notesFor(id).length && { safetyNote: safety.notesFor(id).join(" ") }),
        })),
      );
    },

    start_stretch: ({ stretch_id }) => {
      onLog("tool", `start_stretch ${stretch_id}`);
      const stretch = allowedStretches.STRETCHES.find((s) => s.id === stretch_id);
      if (!stretch) return JSON.stringify({ started: false, reason: "Not available: unknown, or it doesn't suit their health check. Use get_stretches." });
      allowedStretches.startStretch(stretch_id);
      return JSON.stringify({ started: true, name: stretch.name, steps: stretch.steps.length });
    },

    stop_stretch: () => {
      onLog("tool", "stop_stretch");
      stretches.stopStretch();
      return JSON.stringify({ stopped: true });
    },

    // Pressing the app's buttons for them (app-controls.js). The test page has none to press.
    list_buttons: () => {
      onLog("tool", "list_buttons");
      if (!controls) return JSON.stringify({ available: false, reason: "No app screen here." });
      const buttons = controls.list();
      if (Array.isArray(buttons) && buttons.length === 0) {
        return JSON.stringify({
          buttons: [],
          hint: "Nothing on screen yet. If they just asked to start the camera, macOS may be showing a camera permission box: tell them to click Allow.",
        });
      }
      return JSON.stringify(buttons);
    },

    press_button: async ({ button_id }) => {
      if (!controls) return JSON.stringify({ pressed: false, reason: "No app screen here." });
      const result = await controls.press(button_id);
      onLog("tool", `press_button ${button_id} (${result.pressed || "nothing"})`);
      lastActivityAt = Date.now(); // waiting on a button isn't the person going quiet
      return JSON.stringify(result);
    },
  };

  // The stretch runner walks through the steps; during a call she says each one.
  stretches.onStretchEvent((e) => {
    stretchRunning = e.type !== "end";
    if (status !== "talking") return;
    const stretch = stretches.STRETCHES.find((s) => s.id === e.stretchId);
    if (e.type === "start" || e.type === "step") {
      const step = stretch.steps[e.stepIndex];
      // Small delay on "start" so she first gets the start_stretch answer
      setTimeout(
        () => tell(`[app] Stretch step ${e.stepIndex + 1} of ${stretch.steps.length}: ${step.text} (${step.seconds} seconds)`),
        e.type === "start" ? 1500 : 0,
      );
    }
    if (e.type === "end") tell(`[app] Stretch finished: ${stretch.name}.`);
  });

  // ---------------------------------------------------------------------------
  // Every PostureState: updates during a call, wake-up checks otherwise
  // ---------------------------------------------------------------------------

  function update(state, now = Date.now()) {
    latest = state;
    trackSitting(state, now);
    // Posture updates only in calls the app started about posture. When they called her
    // ("Hey Maizy", Talk), she sticks to what they asked; the voice coach nudges between calls.
    if (status === "talking" && AUTO_REASONS.has(reason)) postureUpdates(state, now);
    if (status === "idle") maybeWake(state, now);
  }

  // During a call: tell her when an issue lasts or goes away, without talking over her.
  function postureUpdates(state, now) {
    if (stretchRunning || goodbyeAt || mode === "speaking") return;
    if (now - lastAppLineAt < CALL_RULES.anyLineMs) return;
    const worst = state.issues.find((i) => i.sustained);
    if (worst && now - (lastToldAt[worst.id] ?? 0) > CALL_RULES.sameIssueMs) {
      lastToldAt[worst.id] = now;
      toldIssue = worst.id;
      tell(
        `[app] Sustained posture issue: ${worst.layman.toLowerCase()}. ` +
          `Severity ${Math.round(worst.severity * 10)} out of 10, going on for ${worst.durationSec} seconds. Score is ${state.score}.`,
      );
      return;
    }
    if (toldIssue && !state.issues.some((i) => i.id === toldIssue)) {
      tell(`[app] Posture recovered: no more ${ISSUES[toldIssue].layman.toLowerCase()}. Score is back to ${state.score}.`);
      toldIssue = null;
    }
  }

  // A sit starts when they appear after a break (out of frame for WAKE_RULES.breakMin).
  function trackSitting(state, now) {
    if (!state.present) return;
    if (sitStartedAt === null || now - lastSeenAt > WAKE_RULES.breakMin * 60_000) sitStartedAt = now;
    lastSeenAt = now;
  }

  function maybeWake(state, now) {
    if (!autoWake || stretchRunning) return;
    if (!state.present || !state.calibrated || state.calibrating) return;
    if (now - lastAutoWakeAt < WAKE_RULES.minGapMin * 60_000) return;
    if (autoWakesToday() >= WAKE_RULES.maxPerDay) return;

    const stuck = state.issues.find(
      (i) => i.sustained && i.severity >= WAKE_RULES.stuckMinSeverity && i.durationSec >= WAKE_RULES.stuckIssueSec,
    );
    if (stuck) {
      lastAutoWakeAt = now;
      start("stuck_issue", { issue: stuck, score: state.score });
      return;
    }

    const satMin = (now - sitStartedAt) / 60_000;
    if (satMin >= WAKE_RULES.longSitMin) {
      lastAutoWakeAt = now;
      sitStartedAt = now; // the next long-sit wake-up is another full sit away
      start("long_sitting", { minutes: Math.round(satMin) });
    }
  }

  return {
    update,
    start,
    warmUp,
    end,
    setAutoWake: (on) => (autoWake = Boolean(on)),
    onChange: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    status: () => status,
  };
}
