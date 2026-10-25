// FilesetResolver loads MediaPipe engine and PoseLandmarker is for body point detection which gives an object whose detectForVideo() returns the 33 body points
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const video = document.querySelector('#camera-video');
const status = document.querySelector('#status');
const noseText = document.querySelector('#nose');
const canvas = document.querySelector('#camera-overlay')
const ctx = canvas.getContext('2d') //the "pen" we draw on the canvas with

const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'; // path to the ENGINE: webassembly code which is already compiled and then runs in the browser
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'; // path to the model we're using (pose_landmarker_lite.task)
// 0: nose, 2: left eye, 5: right eye, 7: left ear, 8: right ear, 11: left shoulder, 12: right shoulder, 13: right elbow, 14: left elbow, 23: left hip, 24: right hip
const POINTS_TO_DRAW = [0, 2, 5, 7, 8, 11, 12, 13, 14, 23, 24]
const LINES = [
    [7, 2], // left ear -> left eye
    [5, 8], // right ear -> right eye
    [2, 0], // left eye -> nose
    [5, 0], // right eye -> nose
    [11, 12], // left shoulder -> right shoulder
    [11, 13], // left shoulder -> left elbow
    [12, 14], // right shoulder -> right elbow
    [11, 23],
    [12, 24]
];

const MIN_VISIBILITY = 0.5; // MediaPipe confidence threshold (don't display if < 50% confident node in frame)

const LINE_WIDTH = 3;
const LINE_COLOR = 'rgba(255, 255, 255, 0.8)'
const DASH_PATTERN = [8, 6]; // 8px dash, 6px gap
const NODE_RADIUS = 6;
const NODE_COLOR = '#8bdc85'

let landmarker; // the pose detector

try {
  // Ask for the camera. The browser shows a permission prompt the first time.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
  });

  // Plug the live stream into the <video> tag and start it.
  video.srcObject = stream;
  await video.play();
  
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

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

function isVisible(point){
    // ?? 1 means "if MediaPipe didn't give a visibility score, treat it as visible"
    return (point.visibility ?? 1) >= MIN_VISIBILITY
}

function drawOverlay(person){
    ctx.clearRect(0, 0, canvas.width, canvas.height) // wipe frames last drawings
    if (!person) return;

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    for (const [a, b] of LINES){
        const p1 = person[a];
        const p2 = person[b];
        if (!isVisible(p1) || !isVisible(p2)) continue; // skip if either node is hidden

        // block draws on lines. start a new shape, put pen down, drag, then draw
        ctx.beginPath();
        ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
        ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height)
        ctx.stroke();
    }

    // dashed line from the nose down to the middle of the shoulder line
    const nose = person[0];
    const leftShoulder = person[11];
    const rightShoulder = person[12];
    if (isVisible(nose) && isVisible(leftShoulder) && isVisible(rightShoulder)) {
        // midpoint = the average of the two shoulders
        const midX = (leftShoulder.x + rightShoulder.x) / 2;
        const midY = (leftShoulder.y + rightShoulder.y) / 2;

        ctx.setLineDash(DASH_PATTERN); // turn dashes on
        ctx.beginPath();
        ctx.moveTo(nose.x * canvas.width, nose.y * canvas.height);
        ctx.lineTo(midX * canvas.width, midY * canvas.height);
        ctx.stroke();
        ctx.setLineDash([]); // back to solid, or every later line is dashed too
    }

    ctx.fillStyle = NODE_COLOR;
    for (const i of POINTS_TO_DRAW){
        const p = person[i];
        if (!isVisible(p)) continue;

        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, NODE_RADIUS, 0, Math.PI * 2); // node
        ctx.fill();
    }
}

function detect() {
    const result = landmarker.detectForVideo(video, performance.now()); // detectForVideo() looks at whatever frame the video is showing now.
    const person = result.landmarks[0]; // 33 body points from the person

    drawOverlay(person)

    if (!person) {
        noseText.textContent = 'Nose: nobody in frame';
        return;
    }

    const nose = person[0]; // landmark 0 is the nose
    noseText.textContent = `Nose: x = ${nose.x.toFixed(3)}, y = ${nose.y.toFixed(3)}`;
}
