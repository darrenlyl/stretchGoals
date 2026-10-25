import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { LANDMARKS, MIN_VISIBILITY } from '../shared/contracts.js';

// MediaPipe's engine (WebAssembly) and the pose model live in public/mediapipe/,
// so the app works offline. Vite serves public/ at the site root while developing,
// and copies it next to index.html in the packaged app.
// BASE_URL is '/' while developing and './' in the packaged app, so these paths work in both.
const MEDIAPIPE_DIR = `${import.meta.env.BASE_URL}mediapipe`;
const WASM_FILES = {
  wasmLoaderPath: `${MEDIAPIPE_DIR}/wasm/vision_wasm_internal.js`, // starts the engine
  wasmBinaryPath: `${MEDIAPIPE_DIR}/wasm/vision_wasm_internal.wasm`, // the engine itself
};
const MODEL_PATH = `${MEDIAPIPE_DIR}/pose_landmarker_lite.task`; // the lite pose model

const DETECT_EVERY_MS = 100; // ~10 PoseFrames per second

// 0: nose, 2: left eye, 5: right eye, 7: left ear, 8: right ear, 11: left shoulder,
// 12: right shoulder, 13: left elbow, 14: right elbow, 23: left hip, 24: right hip
const POINTS_TO_DRAW = [0, 2, 5, 7, 8, 11, 12, 23, 24];
const LINES = [
  [7, 2], // left ear -> left eye
  [5, 8], // right ear -> right eye
  [2, 0], // left eye -> nose
  [5, 0], // right eye -> nose
  [11, 12], // left shoulder -> right shoulder
  [11, 23], // left shoulder -> left hip
  [12, 24], // right shoulder -> right hip
];

const LINE_WIDTH = 3;
const LINE_COLOR = 'rgba(255, 255, 255, 0.8)';
const DASH_PATTERN = [8, 6]; // 8px dash, 6px gap
const NODE_RADIUS = 6;
const NODE_COLOR = '#8bdc85';

const CAMERA_SIZE = {width: 640, height: 480} // what we ask the camera for
const CAMERA_STORAGE_KEY = 'stretchGoals.cameraId' // where the chosen camera is remembered

let video; // the <video> element we were given
let canvas; // the <canvas> element we draw the overlay on
let pen; // the "pen" we draw on the canvas with
let stream; // the live camera stream, kept so we can turn it off
let landmarker; // the pose detector, loaded once and reused
let timer; // the setInterval id, kept so we can stop the loop
let overlayVisible = true;
let cameraId = loadCameraId() // the camera the user picked, or null for "default"
const listeners = new Set(); // every callback passed to onPoseFrame()

/**
 * Turns on the camera, loads the pose model and starts sending PoseFrames.
 * Throws if the camera can't start (permission denies, camera bus, no wifi
 * for the model, etc.)
 * @param {HTMLVideoElement} videoE1
 * @param {HTMLCanvasElement} canvasE1
 */
export async function startCamera(videoE1, canvasE1){
    if (timer) return // already running
    video = videoE1
    canvas = canvasE1
    pen = canvas.getContext('2d')
    
    try{
        // Ask for the camera. The browser shows a permission prompt the first time.
        stream = await openCamera()

        // Plug the live stream into the <video> tag and start it.
        video.srcObject = stream;
        video.muted = true;
        video.playsInLine = true;
        await video.play();
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // only load the model the first time. After stopCamera() it's reused
        if (!landmarker){
            // createFromOptions() builds the detector
            landmarker = await PoseLandmarker.createFromOptions(WASM_FILES, {
                baseOptions: { modelAssetPath: MODEL_PATH },
                runningMode: 'VIDEO', // feed it video frames in sequence
                numPoses: 1, // only tracking one person
            });
        }

        // look for a body ~10 times/second. using setInterval, not requestAnimationFrame, so it keeps running when the window is hidden
        timer = setInterval(detect, DETECT_EVERY_MS); // calls detect every 100ms
    } catch (err) {
        stopCamera()
        throw err;
    }
}
/**
 * Stops the loop and turns the camera off. The pose model stays loaded for the next time
 */
export function stopCamera(){
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((track) => track.stop()); // turns camera light off
    stream = null;
    if (video) video.srcObject = null;
    clearOverlay();
}

/**
 * Calls cb(frame) with every new PoseFrame
 * @param {(frame: import('../shared/contracts.js').PoseFrame) => void} cb
 * @returns {() => void} call to stop receiving frames
 */
export function onPoseFrame(cb){
    listeners.add(cb);
    return () => listeners.delete(cb)
}

/**
 * Lists the cameras on users computer. Names are only filled in once the user has allowed
 * camera access, so call this after startCamera()
 * @returns {Promise <{ deviceId: string, label: string }[]}
 */
export async function listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices() // cameras, mics and speakers
    return devices
        .filter((device) => device.kind === 'videoinput') //keep cameras only
        .map((device, i) => ({
            deviceId: device.deviceId,
            label: device.label || `Camera ${i + 1}`
        })); // returns array of json objects with deviceId and label attributes
}

/**
 * Switches to another camera and remembers the choice for next time.
 * If the camera is running it restarts on the new one; if not, the choice is used
 * next startCamera().
 * @param {string} deviceId one of the ids from listCameras()
 */
export async function switchCamera(deviceId){
    cameraId = deviceId;
    saveCameraId(deviceId);
    if (!timer) return; // camera is off so nothing to restart

    stopCamera();
    await startCamera(video, canvas);
}

/**
 * The id of the camera that's on right now, or null if the camera is off.
 */
export function currentCameraId(){
    return stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
}

/**
 * Opens the camera to use: the one the user picked if it's still plugged in, otherwise
 * the default, skipping the infared "Windows Hello" camera if there's another choice
 */
async function openCamera() {
    // getUserMedia only exists on localhost, https, or inside Electron
    if (!navigator.mediaDevices?.getUserMedia) {
        const err = new Error('Camera access is not available on this page.');
        err.name = 'NotSupportedError';
        throw err;
    }

    if (cameraId) {
        try {
            return await navigator.mediaDevices.getUserMedia({
                video: { ...CAMERA_SIZE, deviceId: {exact: cameraId}}
            });
        } catch (err) {
            // the picked camera is gone (unplugged): fall back to the default below.
            // any other error (permission denied, camera busy) is a real problem
            if (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError') throw err;
        }
    }

    const defaultStream = await navigator.mediaDevices.getUserMedia({ video: CAMERA_SIZE });
    if (!isInfrared(defaultStream.getVideoTracks()[0].label)) return defaultStream;

    // the default is the infrared camera (black-and-grey picture): try a normal one instead
    const normalCamera = (await listCameras()).find((camera) => !isInfrared(camera.label));
    if (!normalCamera) return defaultStream; // no other camera, so use what we have

    defaultStream.getTracks().forEach((track) => track.stop());
    return navigator.mediaDevices.getUserMedia({
        video: { ...CAMERA_SIZE, deviceId: { exact: normalCamera.deviceId } },
    });
}

/**
 * Turns an error from startCamera() or switchCamera() into a plain-English message
 * for the user, so the app explains what to do instead of crashing or showing jargon.
 * @param {Error} err
 * @returns {string}
 */
export function describeCameraError(err) {
    switch (err?.name) {
        case 'NotAllowedError': // the user (or the OS) said no to the camera
        case 'SecurityError':
            return 'Camera access is blocked. Allow it in your system settings (Windows: Settings → Privacy & security → Camera. Mac: System Settings → Privacy & Security → Camera), then restart the app.';
        case 'NotReadableError': // the camera exists but something else has it
        case 'AbortError':
            return 'Another app (like Zoom or Teams) is using the camera. Close it, then try again.';
        case 'NotFoundError': // no camera at all
        case 'OverconstrainedError':
            return 'No camera found. Plug one in, then try again.';
        case 'NotSupportedError': // thrown by openCamera() when getUserMedia doesn't exist
            return "This page can't use the camera. Open it in the app or from localhost, not as a file.";
        default: // anything else, e.g. the pose model files failed to load
            return `The camera couldn't start (${err?.name ?? 'unknown error'}). Try restarting the app.`;
    }
}

// Windows lists the face-unlock camera with "IR" or "Infrared" in its name
function isInfrared(label) {
    return /\bIR\b|infrared/i.test(label);
}

// localStorage remembers the chosen camera between app restarts.
// try/catch because storage can be unavailable (e.g. blocked or a private window).
function loadCameraId() {
    try {
        return localStorage.getItem(CAMERA_STORAGE_KEY);
    } catch {
        return null;
    }
}

function saveCameraId(deviceId) {
    try {
        localStorage.setItem(CAMERA_STORAGE_KEY, deviceId);
    } catch {
        // not saved: the picker still works until the app is closed
    }
}

function clearOverlay(){
    if (pen) pen.clearRect(0, 0, canvas.width, canvas.height)
}

/**
 * Shows or hides the dots. Detection keeps running either way
 */
export function setOverlayVisible(visible){
    overlayVisible = visible;
    if (!visible) clearOverlay()
}

function isVisible(point){
    return (point.visibility ?? 1) >= MIN_VISIBILITY;
}

function makePoseFrame(result, timestamp){
    const person = result.landmarks[0] // undefined if no one in frame
    return {
        timestamp, 
        width: video.videoWidth,
        height: video.videoHeight,
        landmarks: person ? person.map((p) => ({x: p.x, y: p.y, z: p.z, visibility: p.visibility})) : null
    };
}

function drawOverlay(person) {
    clearOverlay(); // wipe the last frame's drawing
    if (!person) return;

    pen.strokeStyle = LINE_COLOR;
    pen.lineWidth = LINE_WIDTH;
    for (const [a, b] of LINES) {
    const p1 = person[a];
    const p2 = person[b];
    if (!isVisible(p1) || !isVisible(p2)) continue; // skip if either node is hidden

    // start a new shape, put the pen down, drag, then draw
    pen.beginPath();
    pen.moveTo(p1.x * canvas.width, p1.y * canvas.height);
    pen.lineTo(p2.x * canvas.width, p2.y * canvas.height);
    pen.stroke();
    }

    // dashed line from the nose down to the middle of the shoulder line
    const nose = person[LANDMARKS.nose];
    const leftShoulder = person[LANDMARKS.leftShoulder];
    const rightShoulder = person[LANDMARKS.rightShoulder];
    if (isVisible(nose) && isVisible(leftShoulder) && isVisible(rightShoulder)) {
    // midpoint = the average of the two shoulders
    const midX = (leftShoulder.x + rightShoulder.x) / 2;
    const midY = (leftShoulder.y + rightShoulder.y) / 2;

    pen.setLineDash(DASH_PATTERN); // turn dashes on
    pen.beginPath();
    pen.moveTo(nose.x * canvas.width, nose.y * canvas.height);
    pen.lineTo(midX * canvas.width, midY * canvas.height);
    pen.stroke();
    pen.setLineDash([]); // back to solid, or every later line is dashed too
    }

    pen.fillStyle = NODE_COLOR;
    for (const i of POINTS_TO_DRAW) {
    const p = person[i];
    if (!isVisible(p)) continue;

    pen.beginPath();
    pen.arc(p.x * canvas.width, p.y * canvas.height, NODE_RADIUS, 0, Math.PI * 2);
    pen.fill();
    }
}

function detect() {
    if (video.readyState < 2) return; // 2 = the video has a frame we can look at
    const now = performance.now() // one timestamp shared by MediaPipe and the PoseFrame
    const result = landmarker.detectForVideo(video, now);
    const frame = makePoseFrame(result, now)

    if (overlayVisible) drawOverlay(frame.landmarks);

    for (const cb of listeners){
        try{
            cb(frame)
        } catch (err) {
            // one broken listener shouldn't stop the other from getting frames
            console.error('onPoseFrame listener failed: ', err)
        }
    }
}