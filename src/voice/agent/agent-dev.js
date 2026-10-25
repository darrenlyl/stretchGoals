// The Maizy test page. Two parts:
//   A. Fake posture: buttons pretend to be Darren's PostureState (score + issues).
//   B. Maizy: the same agent and "Hey Maizy" listener the app uses (maizy-agent.js, wake-word.js).
import { Conversation } from "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.27.0/+esm";
import * as Vosk from "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/+esm";
import { ISSUES, ISSUE_IDS } from "../../shared/contracts.js";
import { createMaizyAgent, WAKE_RULES, CALL_RULES } from "./maizy-agent.js";
import { createWakeWord } from "../wake-word.js";

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
// B. Maizy
// ---------------------------------------------------------------------------

const agent = createMaizyAgent({
  Conversation,
  getSignedUrl: async () => (await (await fetch("/signed-url")).json()).signedUrl, // our server holds the key
  onLog: log,
});
const wake = createWakeWord({
  Vosk,
  onWake: (heard) => {
    log("app", `Heard "${heard}"`);
    agent.start("wake_word");
  },
});
let listen = false;

// The "fast" box shrinks the timings so you can see each rule fire in a minute or two.
const REAL = { wake: { ...WAKE_RULES }, call: { ...CALL_RULES } };
const FAST = {
  wake: { stuckIssueSec: 30, longSitMin: 2, minGapMin: 1 },
  call: { sameIssueMs: 20_000, anyLineMs: 10_000 },
};
function applySpeed() {
  const fast = $("fast").checked;
  Object.assign(WAKE_RULES, REAL.wake, fast ? FAST.wake : {});
  Object.assign(CALL_RULES, REAL.call, fast ? FAST.call : {});
}
$("fast").onchange = applySpeed;
applySpeed();

$("autowake").onchange = () => agent.setAutoWake($("autowake").checked);
agent.setAutoWake($("autowake").checked);

// Only one thing uses the mic at a time: the listener, or a call.
function syncListening() {
  if (listen && agent.status() === "idle") wake.start();
  else wake.stop();
}

agent.onChange(({ status }) => {
  $("status").textContent = status;
  $("start").disabled = status !== "idle";
  $("end").disabled = status === "idle";
  syncListening();
});
wake.onState((state, detail) => ($("wakeState").textContent = detail ? `${state}: ${detail}` : state));

$("start").onclick = () => agent.start("talk");
$("end").onclick = () => agent.end();
$("listen").onclick = () => {
  listen = !listen;
  $("listen").textContent = listen ? "Stop listening" : "Listen for “Hey Maizy”";
  syncListening();
};

// Every second: update the fake posture, the screen, and Maizy
setInterval(() => {
  if (fakeIssue) issueSeconds += 1;
  const state = postureState();
  const issue = state.issues[0];
  $("score").textContent = state.score;
  $("issueInfo").textContent = issue
    ? `${issue.medical ?? issue.layman} · ${issue.durationSec}s · ${issue.sustained ? "SUSTAINED" : "not sustained yet"}`
    : "Sitting tall";
  agent.update(state);
}, 1000);

function log(kind, text) {
  const labels = { you: "You", maizy: "Maizy", app: "App →", tool: "Maizy used", err: "Error" };
  const p = document.createElement("p");
  p.className = kind === "tool" ? "app" : kind;
  p.textContent = `${labels[kind]}: ${text}`;
  $("log").append(p);
  $("log").scrollTop = $("log").scrollHeight;
}
