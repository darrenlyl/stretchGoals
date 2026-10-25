// test page for src/camera/index.js

import {
  startCamera,
  stopCamera,
  onPoseFrame,
  setOverlayVisible,
  listCameras,
  switchCamera,
  currentCameraId,
  describeCameraError,
} from './index.js';

const video = document.querySelector('#camera-video');
const canvas = document.querySelector('#camera-overlay');
const status = document.querySelector('#status');
const noseText = document.querySelector('#nose');
const fpsText = document.querySelector('#fps');
const startButton = document.querySelector('#start-button');
const stopButton = document.querySelector('#stop-button');
const overlayCheckbox = document.querySelector('#overlay-checkbox');
const cameraSelect = document.querySelector('#camera-select');
const errorText = document.querySelector('#camera-error');

let framesThisSecond = 0;

// listen for PoseFrames like how Darren's analyze() will
onPoseFrame((frame) => {
  framesThisSecond++;

  if (!frame.landmarks) {
    noseText.textContent = 'Nose: nobody in frame (landmarks: null)';
    return;
  }

  const nose = frame.landmarks[0]; // landmark 0 is the nose
  noseText.textContent = `Nose: x = ${nose.x.toFixed(3)}, y = ${nose.y.toFixed(3)}`;
});

// once a second, show how many PoseFrames arrived (should be about 10)
setInterval(() => {
  fpsText.textContent = `PoseFrames per second: ${framesThisSecond}`;
  framesThisSecond = 0;
}, 1000);

startButton.addEventListener('click', start);
stopButton.addEventListener('click', stop);
overlayCheckbox.addEventListener('change', () => {
  setOverlayVisible(overlayCheckbox.checked);
});
cameraSelect.addEventListener('change', changeCamera);

// plugging a webcam in or out changes the list of cameras
navigator.mediaDevices?.addEventListener('devicechange', fillCameraList);

start(); // start straight away when the page opens

async function start() {
  startButton.disabled = true;
  status.textContent = 'Starting camera and loading pose model…';

  try {
    await startCamera(video, canvas);
    // Show which camera we got. On Windows, an "IR" camera means we grabbed the wrong one.
    const cameraName = video.srcObject.getVideoTracks()[0].label;
    status.textContent = `Camera on: ${cameraName}. Pose model ready.`;
    stopButton.disabled = false;
    errorText.textContent = ''; // clear any earlier error
    await fillCameraList(); // camera names are only available after permission is granted
  } catch (err) {
    errorText.textContent = describeCameraError(err); // the friendly version
    // NotAllowedError = permission denied, NotReadableError = another app is using the camera.
    status.textContent = `Couldn't start the camera: ${err.name}. ${err.message}`;
    console.error(err);
    startButton.disabled = false;
  }
}

function stop() {
  stopCamera();
  status.textContent = 'Camera off.';
  noseText.textContent = '';
  stopButton.disabled = true;
  startButton.disabled = false;
}

// runs when a different camera is picked in the dropdown
async function changeCamera() {
  status.textContent = 'Switching camera…';
  try {
    await switchCamera(cameraSelect.value);
    errorText.textContent = '';
    if (currentCameraId()) {
      const cameraName = video.srcObject.getVideoTracks()[0].label;
      status.textContent = `Camera on: ${cameraName}. Pose model ready.`;
    } else {
      status.textContent = 'Camera off. The new camera will be used next time.';
    }
  } catch (err) {
    // switching stops the old camera first, so the camera is off now
    status.textContent = `Couldn't start the camera: ${err.name}. ${err.message}`;
    errorText.textContent = describeCameraError(err);
    console.error(err);
    stopButton.disabled = true;
    startButton.disabled = false;
  }
}

// fills the dropdown with one <option> per camera, and selects the one that's on
async function fillCameraList() {
  const cameras = await listCameras();
  // new Option(text, value) makes an <option> element
  cameraSelect.replaceChildren(
    ...cameras.map((camera) => new Option(camera.label, camera.deviceId)),
  );
  cameraSelect.value = currentCameraId() ?? '';
  cameraSelect.disabled = cameras.length === 0;
}
