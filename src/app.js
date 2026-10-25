// Window entry point. Connects all the modules (TEAM_GUIDE.md Section 2).
import './index.css';
import { Conversation } from '@elevenlabs/client';
import * as Vosk from 'vosk-browser';
import { ui } from './ui/index.js';
import { maizy } from './maizy/index.js';
import * as voice from './voice/index.js';
import * as stretches from './stretches/index.js';
import { createMaizyAgent } from './voice/agent/maizy-agent.js';
import { createWakeWord } from './voice/wake-word.js';

// Jordan's camera and Darren's posture modules plug in here as soon as their files exist.
// import.meta.glob returns {} for a missing file instead of failing the build.
const camera = Object.values(import.meta.glob('./camera/index.js', { eager: true }))[0] ?? standInCamera();
const posture = Object.values(import.meta.glob('./posture/index.js', { eager: true }))[0];

console.log('stretchGoals renderer loaded', { realCamera: !camera.standIn, realPosture: !!posture });

// ---------------------------------------------------------------------------
// Maizy, the live voice agent: woken by "Hey Maizy", the Talk button, or the app (WAKE_RULES)
// ---------------------------------------------------------------------------

const canCall = Boolean(window.api?.maizySignedUrl); // only inside Electron, where the API key lives
const agent = createMaizyAgent({
  Conversation,
  getSignedUrl: () => window.api.maizySignedUrl(),
  onLog: (kind, text) => console.log(`[maizy] ${kind}: ${text}`),
});
const wake = createWakeWord({
  Vosk,
  onWake: () => agent.start('wake_word'),
  isBlocked: () => voice.isSpeaking(), // the coach saying "Hey, Maizy here" shouldn't wake her
});

let paused = false;
let voiceOn = true;
let heyMaizyOn = readSetting('maizy.heyMaizy', true);

// The app may only wake her by itself on REAL posture data. The fake panel says "sitting,
// calibrated" nonstop, so it would start a paid call every 50 minutes in dev.
function updateAutoWake() {
  agent.setAutoWake(Boolean(posture) && voiceOn && !paused);
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
  renderCallChip();
});
wake.onState(renderCallChip);

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
// UI, Maizy mascot, posture
// ---------------------------------------------------------------------------

ui.mount(document.querySelector('#app'), { camera, posture, voice: voiceForUi, stretches });
maizy.mount(document.querySelector('#maizy')); // the UI made this slot

// Every PostureState, real or fake, goes everywhere through here.
function handleState(state) {
  ui.update(state);
  maizy.update(state);
  voice.voiceCoach.update(state);
  agent.update(state);
  window.api?.setTrayScore(state.score);
}

// Pause stops posture checks, the "Hey Maizy" mic, and any call.
ui.onPauseChange((p) => {
  paused = p;
  updateAutoWake();
  if (paused) agent.end();
  syncListening();
});

if (posture && camera.onPoseFrame) {
  camera.onPoseFrame((frame) => {
    if (!paused) handleState(posture.analyze(frame));
  });
}

window.api?.onTrayCommand((command) => {
  if (command === 'pause') ui.setPaused(true);
  if (command === 'resume') ui.setPaused(false);
  if (command === 'recalibrate') ui.showScreen('calibrate');
  if (command === 'talk') agent.start('talk');
});

// Dev only, until Darren's posture module exists: the fake panel stands in for analyze().
if (import.meta.env.DEV && !posture) {
  import('./debug/fake-posture.js').then(({ mountFakePosturePanel }) => {
    mountFakePosturePanel(document.querySelector('#debug-panel'), (state) => {
      if (!paused) handleState(state);
    });
  });
}

// ---------------------------------------------------------------------------
// The call chip: shows whether the mic is listening or Maizy is on a call, with Talk / End / on-off
// ---------------------------------------------------------------------------

const chip = document.querySelector('#maizy-call');
let wakeState = 'off';
let wakeDetail = '';

function renderCallChip(state, detail) {
  if (typeof state === 'string') [wakeState, wakeDetail] = [state, detail ?? ''];
  if (!canCall) return chip.replaceChildren();

  const status = agent.status();
  let text;
  let buttons;
  if (status === 'connecting') {
    text = 'Calling Maizy…';
    buttons = [button('End', () => agent.end())];
  } else if (status === 'talking') {
    text = 'Talking to Maizy';
    buttons = [button('End', () => agent.end())];
  } else {
    text = {
      listening: 'Say “Hey Maizy”',
      loading: 'Getting “Hey Maizy” ready…',
      error: `“Hey Maizy” isn't working: ${wakeDetail}`,
      off: paused ? 'Paused' : '“Hey Maizy” is off',
    }[wakeState];
    buttons = [
      button('Talk', () => agent.start('talk')),
      button(heyMaizyOn ? 'Stop listening' : 'Listen', () => {
        heyMaizyOn = !heyMaizyOn;
        saveSetting('maizy.heyMaizy', heyMaizyOn);
        syncListening();
        renderCallChip();
      }),
    ];
  }
  chip.dataset.state = status === 'idle' ? wakeState : status;
  const label = document.createElement('span');
  label.textContent = text;
  chip.replaceChildren(label, ...buttons);
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.onclick = onClick;
  return b;
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

renderCallChip();
syncListening();

// TEMPORARY: just shows the webcam so the Start button works. Replaced by Jordan's camera/index.js.
function standInCamera() {
  return {
    standIn: true,
    async startCamera(video) {
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true });
    },
  };
}
