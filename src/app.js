// Renderer entry point: wires the camera, posture, voice, Ossie and UI modules together.
// See TEAM_GUIDE.md Section 2 for the plan. Runs in the window, not in Node.

import './index.css';

console.log('stretchGoals renderer loaded');

// TEMPORARY (Job 2): plain camera feed to prove permission works.
// Jordan's startCamera() replaces this at checkpoint 1.
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

// Turns a getUserMedia error into a sentence a normal person can act on.
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
