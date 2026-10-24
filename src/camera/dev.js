// FilesetResolver loads MediaPipe engine and PoseLandmarker is for body point detection which gives an object whose detectForVideo() returns the 33 body points
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const video = document.querySelector('#camera-video');
const status = document.querySelector('#status');
const noseText = document.querySelector('#nose');

const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'; // path to the ENGINE: webassembly code which is already compiled and then runs in the browser
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'; // path to the model we're using (pose_landmarker_lite.task)

let landmarker; // the pose detector

try {
  // Ask for the camera. The browser shows a permission prompt the first time.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
  });

  // Plug the live stream into the <video> tag and start it.
  video.srcObject = stream;
  await video.play();

  // Show which camera we got. On Windows, an "IR" camera means we grabbed the wrong one.
  const cameraName = stream.getVideoTracks()[0].label;

  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  // createFromOptions() builds the detector
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    runningMode: 'VIDEO', // feed it video frames in sequence
    numPoses: 1, // only tracking one person
  });
  status.textContent = `Camera on: ${cameraName}. Pose model ready.`;

  // look for a body ~10 times/second. using setInterval, not requestAnimationFrame, so it keeps running when the window is hidden
  setInterval(detect, 100); // calls detect every 100ms
} catch (err) {
  // NotAllowedError = permission denied, NotReadableError = another app is using the camera.
  status.textContent = `Couldn't start the camera: ${err.name}. ${err.message}`;
  console.error(err);
}

function detect() {
  const result = landmarker.detectForVideo(video, performance.now()); // detectForVideo() looks at whatever frame the video is showing now.
  const person = result.landmarks[0]; // 33 body points from the person

  if (!person) {
    noseText.textContent = 'Nose: nobody in frame';
    return;
  }

  const nose = person[0]; // landmark 0 is the nose
  noseText.textContent = `Nose: x = ${nose.x.toFixed(3)}, y = ${nose.y.toFixed(3)}`;
}
