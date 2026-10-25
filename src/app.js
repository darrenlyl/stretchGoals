// Window entry point. Connects all the modules (TEAM_GUIDE.md Section 2):
// camera -> posture -> UI, Maizy, voice coach, notifications and the tray score.
import './index.css';
import * as camera from './camera/index.js';
import * as posture from './posture/index.js';
import * as voice from './voice/index.js';
import * as stretches from './stretches/index.js';
import { ui } from './ui/index.js';
import { maizy } from './maizy/index.js';
import { postureNotifier } from './notifications.js';

// The UI builds every screen, including the camera and Maizy's slot. Its Start button calls camera.startCamera().
ui.mount(document.querySelector('#app'), { camera, posture, voice, stretches });
maizy.mount(document.querySelector('#maizy'));

let paused = false;
let useFake = false; // dev only: the fake posture panel drives the app instead of the camera

// Every PostureState goes to everyone who reacts to posture.
function handleState(state) {
  ui.update(state);
  maizy.update(state);
  voice.voiceCoach.update(state);
  postureNotifier.update(state);
  window.api?.setTrayScore(state.score);
}

// Real pipeline: ~10 PoseFrames a second from the camera, judged by the posture brain.
camera.onPoseFrame((frame) => {
  if (paused || useFake) return;
  handleState(worstFirst(posture.analyze(frame)));
});

// Pause: from the UI's button or the tray. Stop judging frames and alerting while paused.
ui.onPauseChange((value) => {
  paused = value;
  postureNotifier.setPaused(value);
});
window.api?.onTrayCommand((command) => {
  if (command === 'pause') ui.setPaused(true);
  if (command === 'resume') ui.setPaused(false);
  if (command === 'recalibrate') ui.showScreen('calibrate');
});

// The contract promises issues worst first; the voice coach and notifications rely on it.
function worstFirst(state) {
  return { ...state, issues: [...state.issues].sort((a, b) => b.severity - a.severity) };
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
      if (useFake) ui.showScreen('dashboard');
    };
    mountFakePosturePanel(panelSpot, (state) => {
      if (useFake && !paused) handleState(state);
    });
  });
  window.api.onTrayCommand((command) => console.log('Tray command:', command));
}
