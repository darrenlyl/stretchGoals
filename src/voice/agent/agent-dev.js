// The Maizy test page. Three parts:
//   A. Fake posture: buttons pretend to be Darren's PostureState (score + issues).
//   B. Coach rules: decide WHEN to tell Maizy something, so she speaks up on her own without nagging.
//   C. The conversation: connect to the ElevenLabs agent and answer her tool calls.
import { Conversation } from "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.27.0/+esm";
import { ISSUES, ISSUE_IDS } from "../../shared/contracts.js";
import * as stretches from "../../stretches/index.js";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// A. Fake posture (stands in for Darren's analyze() until the camera is wired up)
// ---------------------------------------------------------------------------

const SUSTAINED_AFTER_SEC = 5;
let fakeIssue = null; // which issue the buttons say is happening, or null
let issueSeconds = 0;

// Build a PostureState shaped exactly like src/shared/contracts.js
function postureState() {
  const severity = Number($("severity").value);
  const issues = fakeIssue
    ? [{ id: fakeIssue, ...ISSUES[fakeIssue], severity, durationSec: issueSeconds, sustained: issueSeconds >= SUSTAINED_AFTER_SEC }]
    : [];
  return {
    timestamp: performance.now(),
    present: true,
    calibrated: true,
    calibrating: false,
    calibrationProgress: 1,
    score: fakeIssue ? Math.round(100 - severity * 60) : 100,
    issues,
  };
}

function setFakeIssue(id) {
  fakeIssue = id;
  issueSeconds = 0;
  document.querySelectorAll("#issues button").forEach((b) => b.classList.toggle("active", b.dataset.id === String(id)));
}

// One button per issue, plus "Sit up straight"
$("issues").append(
  ...[null, ...ISSUE_IDS].map((id) => {
    const b = document.createElement("button");
    b.dataset.id = String(id);
    b.textContent = id ? ISSUES[id].layman : "Sit up straight";
    b.onclick = () => setFakeIssue(id);
    return b;
  }),
);
setFakeIssue(null);

// ---------------------------------------------------------------------------
// B. Coach rules: the app decides when Maizy should speak up (TEAM_GUIDE Track 3, milestone 4)
// ---------------------------------------------------------------------------

const lastWarnedAt = {}; // issueId -> time we last told Maizy about it
let lastAppMessageAt = 0;
let warnedIssue = null; // the issue Maizy was told about, so we can praise when it's gone
let stretching = false;

const cooldowns = () =>
  $("fast").checked
    ? { sameIssueMs: 20_000, anyLineMs: 10_000 } // for testing
    : { sameIssueMs: 180_000, anyLineMs: 60_000 }; // the real rules: 3 min per issue, 60 s between lines

function coachRules(state) {
  if (!conversation || stretching) return;
  if (maizyMode === "speaking") return; // never talk over her
  const now = Date.now();
  const { sameIssueMs, anyLineMs } = cooldowns();
  if (now - lastAppMessageAt < anyLineMs) return;

  const worst = state.issues.find((i) => i.sustained);

  // A sustained issue she hasn't mentioned recently: tell her, and she'll bring it up.
  if (worst && now - (lastWarnedAt[worst.id] ?? 0) > sameIssueMs) {
    lastWarnedAt[worst.id] = now;
    warnedIssue = worst.id;
    tellMaizy(
      `[app] Sustained posture issue: ${worst.medical ?? worst.layman} (plain words: ${worst.layman.toLowerCase()}). ` +
        `Severity ${Math.round(worst.severity * 10)} out of 10, going on for ${worst.durationSec} seconds. Score is ${state.score}.`,
    );
    return;
  }

  // The issue she warned about is gone: let her praise them.
  if (warnedIssue && !state.issues.some((i) => i.id === warnedIssue)) {
    tellMaizy(`[app] Posture recovered: no more ${ISSUES[warnedIssue].layman.toLowerCase()}. Score is back to ${state.score}.`);
    warnedIssue = null;
  }
}

// sendUserMessage makes her take a turn and respond. Her prompt says "[app]" messages come from the app, not the person.
function tellMaizy(text) {
  lastAppMessageAt = Date.now();
  conversation?.sendUserMessage(text);
  log("app", text);
}

// Every second: update the fake posture, the screen, and run the rules
setInterval(() => {
  if (fakeIssue) issueSeconds += 1;
  const state = postureState();
  const issue = state.issues[0];
  $("score").textContent = state.score;
  $("issueInfo").textContent = issue
    ? `${issue.medical ?? issue.layman} · ${issue.durationSec}s · ${issue.sustained ? "SUSTAINED" : "not sustained yet"}`
    : "Sitting tall";
  coachRules(state);
}, 1000);

// Stretches: the runner walks through the steps on a timer; we pass each step to Maizy to say out loud.
stretches.onStretchEvent((e) => {
  const stretch = stretches.STRETCHES.find((s) => s.id === e.stretchId);
  if (e.type === "start" || e.type === "step") {
    const step = stretch.steps[e.stepIndex];
    $("stretchInfo").textContent = `Stretch: ${stretch.name}, step ${e.stepIndex + 1} of ${stretch.steps.length}`;
    // Small delay on "start" so Maizy first gets the start_stretch answer
    setTimeout(
      () => tellMaizy(`[app] Stretch step ${e.stepIndex + 1} of ${stretch.steps.length}: ${step.text} (${step.seconds} seconds)`),
      e.type === "start" ? 1500 : 0,
    );
  }
  if (e.type === "end") {
    stretching = false;
    $("stretchInfo").textContent = "";
    tellMaizy(`[app] Stretch finished: ${stretch.name}.`);
    setFakeIssue(null); // pretend the stretch fixed their posture
  }
});

// ---------------------------------------------------------------------------
// C. The conversation with the ElevenLabs agent
// ---------------------------------------------------------------------------

let conversation = null;
let maizyMode = "listening";

// Her "buttons" in our app. Names must match the tools in maizy-config.mjs exactly.
const clientTools = {
  get_posture_snapshot: () => {
    const s = postureState();
    log("tool", "get_posture_snapshot");
    return JSON.stringify({
      calibrated: s.calibrated,
      score: s.score,
      issues: s.issues.map((i) => ({ id: i.id, medical: i.medical, plain: i.layman, severity: i.severity, seconds: i.durationSec })),
    });
  },

  get_stretches: ({ issue_id } = {}) => {
    log("tool", `get_stretches ${issue_id ?? ""}`);
    const list = issue_id ? stretches.stretchesFor(issue_id) : stretches.STRETCHES;
    return JSON.stringify(
      list.map(({ id, name, how, cue, reps, bothSides, cautionNote, helps, source }) => ({
        id, name, how, cue, reps, bothSides, cautionNote, helps, source: source.name,
      })),
    );
  },

  start_stretch: ({ stretch_id }) => {
    log("tool", `start_stretch ${stretch_id}`);
    const stretch = stretches.STRETCHES.find((s) => s.id === stretch_id);
    if (!stretch) return JSON.stringify({ started: false, reason: "No stretch with that id. Use get_stretches." });
    stretching = true;
    stretches.startStretch(stretch_id);
    return JSON.stringify({ started: true, name: stretch.name, steps: stretch.steps.length });
  },

  stop_stretch: () => {
    log("tool", "stop_stretch");
    stretches.stopStretch();
    return JSON.stringify({ stopped: true });
  },
};

$("start").onclick = async () => {
  $("start").disabled = true;
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true }); // asks for the microphone
    const { signedUrl } = await (await fetch("/signed-url")).json(); // our server talks to ElevenLabs with the key
    conversation = await Conversation.startSession({
      signedUrl,
      connectionType: "websocket",
      clientTools,
      onConnect: () => log("app", "Connected to Maizy"),
      onDisconnect: () => {
        log("app", "Conversation ended");
        conversation = null;
        $("start").disabled = false;
        $("end").disabled = true;
      },
      onStatusChange: ({ status }) => ($("status").textContent = status),
      onModeChange: ({ mode }) => ($("mode").textContent = maizyMode = mode),
      onMessage: ({ message, role, source }) => {
        const who = (role ?? source) === "user" ? "you" : "maizy";
        if (!message.startsWith("[app]")) log(who, message); // app messages are already logged
      },
      onError: (err) => log("err", String(err?.message ?? err)),
    });
    $("end").disabled = false;
  } catch (err) {
    log("err", String(err?.message ?? err));
    $("start").disabled = false;
  }
};

$("end").onclick = () => conversation?.endSession();

function log(kind, text) {
  const labels = { you: "You", maizy: "Maizy", app: "App →", tool: "Maizy used", err: "Error" };
  const p = document.createElement("p");
  p.className = kind === "tool" ? "app" : kind;
  p.textContent = `${labels[kind]}: ${text}`;
  $("log").append(p);
  $("log").scrollTop = $("log").scrollHeight;
}
