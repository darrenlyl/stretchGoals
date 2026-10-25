// Window entry point. Connects all the modules (TEAM_GUIDE.md Section 2):
// camera -> posture -> UI, Maizy, voice coach, Maizy the voice agent, notifications and the tray.
import './index.css';
import { Conversation } from '@elevenlabs/client';
import * as Vosk from 'vosk-browser';
import * as camera from './camera/index.js';
import * as posture from './posture/index.js';
import * as voice from './voice/index.js';
import * as stretches from './stretches/index.js';
import { ui } from './ui/index.js';
import { maizy } from './maizy/index.js';
import { postureNotifier } from './notifications.js';
import { createMaizyAgent } from './voice/agent/maizy-agent.js';
import { createAppControls } from './voice/agent/app-controls.js';
import { createWakeWord } from './voice/wake-word.js';

let paused = false;
let useFake = false; // dev only: the fake posture panel drives the app instead of the camera
let cameraLive = false; // true once the camera has sent a frame (the UI's Start button turned it on)
let voiceOn = true;
let heyMaizyOn = readSetting('maizy.heyMaizy', true);

// ---------------------------------------------------------------------------
// Maizy, the live voice agent: woken by "Hey Maizy", the tray's Talk, or the app (WAKE_RULES)
// ---------------------------------------------------------------------------

const canCall = Boolean(window.api?.maizySignedUrl); // only inside Electron, where the API key lives
const agent = createMaizyAgent({
  Conversation,
  getSignedUrl: () => window.api.maizySignedUrl(),
  controls: createAppControls(document.querySelector('#app')), // "can you start the camera?"
  onLog: (kind, text) => console.log(`[maizy] ${kind}: ${text}`),
});
const wake = createWakeWord({
  Vosk,
  onWake: () => agent.start('wake_word', { heardAt: Date.now() }),
  isBlocked: () => voice.isSpeaking(), // the coach saying "Hey, Maizy here" shouldn't wake her
});

// The app may only wake her by itself on REAL posture data. The fake panel can say "sitting,
// calibrated" nonstop, which would start a paid call every 50 minutes in dev.
function updateAutoWake() {
  agent.setAutoWake(!useFake && voiceOn && !paused);
}
updateAutoWake();

// Only one thing uses the mic at a time: the "Hey Maizy" listener, or a call.
function syncListening() {
  const listen = canCall && heyMaizyOn && !paused && agent.status() === 'idle';
  if (listen) wake.start();
  else wake.stop();
}

agent.onChange(({ status }) => {
  voice.voiceCoach.setAgentActive(status !== 'idle'); // one voice at a time
  syncListening();
  sendMaizyStatus();
});

let wakeState = 'off';
wake.onState((state) => {
  wakeState = state;
  if (state === 'listening') agent.warmUp(); // a signed URL ready for when they say her name
  sendMaizyStatus();
});

// The menu bar shows a dot next to the score ("•" listening, "◉" on a call) and the tray menu
// has Talk / End call / Listen for "Hey Maizy", so nothing sits on top of the window.
function sendMaizyStatus() {
  if (canCall)
    window.api.setMaizyStatus({
      call: agent.status(),
      wake: wakeState,
      listenOn: heyMaizyOn,
    });
}

function toggleListening() {
  heyMaizyOn = !heyMaizyOn;
  saveSetting('maizy.heyMaizy', heyMaizyOn);
  syncListening();
  sendMaizyStatus();
}

// The UI's voice switch also stops Maizy waking up by herself.
const voiceForUi = {
  ...voice,
  voiceCoach: {
    ...voice.voiceCoach,
    setMuted(muted) {
      voice.voiceCoach.setMuted(muted);
      voiceOn = !muted;
      updateAutoWake();
    },
  },
};

// ---------------------------------------------------------------------------
// UI, Maizy mascot, the posture pipeline
// ---------------------------------------------------------------------------

// The UI builds every screen, including the camera and Maizy's slot. Its Start button calls camera.startCamera().
ui.mount(document.querySelector('#app'), {
  camera,
  posture,
  voice: voiceForUi,
  stretches,
});
maizy.mount(document.querySelector('#maizy'));

// Every PostureState goes to everyone who reacts to posture.
function handleState(state) {
  ui.update(state);
  maizy.update(state);
  voice.voiceCoach.update(state);
  postureNotifier.update(state);
  agent.update(state);
  window.api?.setTrayScore(state.score);
}

// Real pipeline: ~10 PoseFrames a second from the camera, judged by the posture brain.
camera.onPoseFrame((frame) => {
  cameraLive = true;
  if (paused || useFake) return;
  handleState(worstFirst(posture.analyze(frame)));
});

// Pause: from the UI's button or the tray. Stops judging frames, alerts, the "Hey Maizy" mic and any call.
ui.onPauseChange((value) => {
  paused = value;
  postureNotifier.setPaused(value);
  window.api?.setPaused(value); // the tray's Pause/Resume item follows
  updateAutoWake();
  if (paused) agent.end();
  syncListening();
});
window.api?.onTrayCommand((command) => {
  if (command === 'pause') ui.setPaused(true);
  if (command === 'resume') ui.setPaused(false);
  if (command === 'recalibrate' && cameraLive) {
    posture.resetCalibration(); // same as Settings > Recalibrate: forget the old baseline first
    ui.showScreen('calibrate');
  }
  if (command === 'talk') agent.start('talk');
  if (command === 'end-call') agent.end();
  if (command === 'toggle-listen') toggleListening();
});

// The contract promises issues worst first; the voice coach and notifications rely on it.
function worstFirst(state) {
  return {
    ...state,
    issues: [...state.issues].sort((a, b) => b.severity - a.severity),
  };
}

// Dev only: a fake posture panel under the app, for testing without a camera.
// Tick "Use fake posture" and the panel drives the UI, Maizy, voice, notifications and tray.
if (import.meta.env.DEV && window.api) {
  import('./debug/fake-posture.js').then(({ mountFakePosturePanel }) => {
    const debugPanel = document.querySelector('#debug-panel');
    const toggle = document.createElement('label');
    toggle.className = 'fake-toggle';
    toggle.innerHTML = '<input type="checkbox" /> Use fake posture (dev only)';
    const panelSpot = document.createElement('div');
    debugPanel.append(toggle, panelSpot);

    toggle.querySelector('input').onchange = (event) => {
      useFake = event.target.checked;
      updateAutoWake();
      if (useFake) ui.showScreen('dashboard');
    };
    mountFakePosturePanel(panelSpot, (state) => {
      if (useFake && !paused) handleState(state);
    });
  });
  window.api.onTrayCommand((command) => console.log('Tray command:', command));
}

// localStorage can be missing or throw (private mode); the default still works then.
function readSetting(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function saveSetting(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not saved, only lasts this run
  }
}

sendMaizyStatus();
syncListening();
