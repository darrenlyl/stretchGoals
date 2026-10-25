// Window entry point. Connects all the modules (TEAM_GUIDE.md Section 2).
import './index.css';
import { maizy } from './maizy/index.js';

console.log('stretchGoals renderer loaded');

maizy.mount(document.querySelector('#maizy'));

// TEMPORARY: plain camera feed. Replaced by Jordan's startCamera() at checkpoint 1.
const video = document.querySelector('#camera-video');
const cameraError = document.querySelector('#camera-error');

async function showCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    cameraError.textContent = '';
  } catch (err) {
    console.error('Camera failed:', err.name, err.message);
    cameraError.textContent = cameraErrorMessage(err);
  }
}

// Turns a camera error into a helpful message.
function cameraErrorMessage(err) {
  const onWindows = navigator.userAgent.includes('Windows');
  if (err.name === 'NotAllowedError') {
    return onWindows
      ? 'Camera access is blocked. Turn it on in Settings → Privacy & security → Camera, then restart the app.'
      : 'Camera access is blocked. Turn it on in System Settings → Privacy & Security → Camera, then restart the app.';
  }
  if (err.name === 'NotReadableError') {
    return 'Another app (like Zoom or FaceTime) is using the camera. Close it, then reload with Cmd+R / Ctrl+R.';
  }
  if (err.name === 'NotFoundError') {
    return 'No camera found. Plug one in, then reload.';
  }
  return `The camera could not start (${err.name}). Try restarting the app.`;
}

showCamera();

// Dev only: the fake posture panel drives Maizy and the tray until real modules are wired (Job 6).
if (import.meta.env.DEV && window.api) {
  import('./debug/fake-posture.js').then(({ mountFakePosturePanel }) => {
    mountFakePosturePanel(document.querySelector('#debug-panel'), (state) => {
      maizy.update(state);
      window.api.setTrayScore(state.score);
    });
  });
  window.api.onTrayCommand((command) => console.log('Tray command:', command));
}
