# stretchGoals: Team Guide

> A desktop app for Mac and Windows that watches your posture through the laptop camera. It tells you what's off in plain words and by the medical term, then coaches you back with a voice and guided stretches. Maizy, a little blonde girl, slouches when you slouch.

This is the single source of truth for the hackathon. Read it once at kickoff. Then give it to your AI assistant so it knows the plan, the rules, and your role.

| Track | Owner | Nickname | Folders you own |
|---|---|---|---|
| 1. Camera & Pose | **Jordan** | the eyes | `src/camera/`, `data/recordings/` |
| 2. Posture Brain | **Darren** | the doctor | `src/posture/`, `src/shared/` |
| 3. Voice Coach & Stretches | **Joseph** | the coach | `src/voice/`, `src/stretches/` |
| 4. Desktop App & Maizy | **Shawn** | the body | `src/main.js`, `src/preload.js`, `src/app.js`, `src/notifications.js`, `src/maizy/`, `src/debug/`, `forge.config.mjs` |
| UI screens | **Darren** | the face | `src/ui/` |

**Contents**
0. [Notes for your AI assistant](#0-notes-for-your-ai-assistant)
1. [The vision](#1-the-vision)
2. [How the pieces fit together](#2-how-the-pieces-fit-together)
3. [Shared contracts](#3-shared-contracts-the-most-important-section)
4. [Stack, setup & folder layout](#4-stack-setup--folder-layout)
5. [Team practices](#5-team-practices)
6. [Timeline & checkpoints](#6-timeline--checkpoints)
7. [Track guides](#7-track-guides)
8. [Demo plan & fallbacks](#8-demo-plan--fallbacks)
9. [Glossary](#9-glossary)

---

## 0. Notes for your AI assistant

**Teammates:** open your AI coding assistant in this repo and start with:
> Read TEAM_GUIDE.md. I'm **<your name>** and I own **Track <n>**. Help me get started.

**Assistant, here is how to help:**

- **Who you're helping.** This is a team of four people with little coding experience, at a 24-hour hackathon. They want to *learn* and they also need to *ship*. Act like a patient senior teammate. If you don't know which teammate you're talking to, ask.
- **Teach by default.**
  - Explain the idea in a few sentences, show a small snippet, and let them write and run it.
  - When something breaks, explain what the error means before fixing it.
  - Check they understood before moving on.
- **Give complete code when it makes sense:**
  - when they ask for it
  - when they've been stuck for about 20 minutes
  - when it's boilerplate, like config, setup, or packaging

  In those cases, say briefly what each part does.
- **Stay in their lane.**
  - Only edit the folders their track owns (table above).
  - Don't edit other tracks' folders.
  - Don't edit `src/ui/`, which Darren owns.
  - Don't edit `src/shared/contracts.js`, which Darren owns.
  - If a contract change seems necessary, write up the proposed change and ask the human to raise it with the team.
- **Code exactly to the contracts in Section 3.** That means the same field names, issue IDs, and function names. Until another track's real module exists, build against fake data.
- **Keep the stack.**
  - Use plain JavaScript (ES modules), Electron Forge with Vite, `@mediapipe/tasks-vision`, and the ElevenLabs REST API.
  - Don't put TypeScript, React, or other frameworks inside the modules.
  - Ask the team before adding any npm dependency.
- **Secrets.** The ElevenLabs API key lives in `.env` and is read only by the Electron main process. Never put it in renderer code, in a commit, or in chat.
- **Libraries change.** Treat this guide's snippets as starting points. If an API doesn't behave as described, check the current docs.
- **Mind the clock.**
  - Suggest the simplest thing that works for the demo.
  - Warn when something is a rabbit hole.
  - Point to the "if you finish early" list instead of polishing.
- **Git.** Don't commit or push unless the person asks.

---

## 1. The vision

### The problem
People hunch at laptops for hours. Their neck creeps forward ("tech neck"), their shoulders round, and they don't notice until it hurts.

### What stretchGoals does
1. **Watches** your posture through the built-in camera. Everything is processed on your laptop, and no video ever leaves it.
2. **Calibrates** to *you*. You sit up straight for 3 seconds, and that becomes your personal "good" posture.
3. **Explains** what's wrong using both names, for example *Forward head posture: "your neck is too far forward."*
4. **Scores** your posture from 0 to 100 in real time, shown in the app and in the tray icon (the menu bar on Mac, the taskbar tray on Windows).
5. **Coaches** you with a friendly ElevenLabs voice, without nagging.
6. **Fixes** it with short guided stretches matched to your problem.
7. **Mirrors** you through **Maizy**, a little girl whose posture copies yours.

### The demo moment
The judge sits down and calibrates. Then they slouch:
- Maizy slouches with them.
- The score drops.
- A voice says "Forward head posture. In plain words, your neck's too far out. Want to try a chin tuck?"
- The voice leads the stretch.

When they sit up, the score recovers and Maizy cheers. Everything we build serves this 60-second story.

### What makes it stand out
- **Private:** the AI runs locally, and only short text lines go to ElevenLabs.
- **Educational:** it shows medical terms next to plain language.
- **Personal:** it calibrates to the person, so it doesn't compare them to some "perfect" body.
- **Delightful:** Maizy gives it personality.

### Non-goals (don't spend time here)
- It is not a medical device. Show a "not medical advice" line in the app.
- No side-view camera setups, multiple people, or Linux support.
- No user accounts, cloud sync, or history graphs. A history graph is a stretch goal at most.

---

## 2. How the pieces fit together

```
 Webcam
   │
   ▼
[Track 1: camera]  ── PoseFrame, ~10 per second ──►  [Track 2: posture]  ── PostureState ──┬──► [UI: score, issues, calibration]
   │                                                                                      ├──► [Track 4: Maizy, tray score, notifications]
   └──► video + dot overlay (shown inside the UI)                                          └──► [Track 3: voice coach, stretch suggestions]

 [Track 4: the Electron shell wraps everything. The main process holds the ElevenLabs key.]
```

Shawn owns `src/app.js`, which wires it all together. It will look roughly like this:

```js
import { startCamera, onPoseFrame } from "./camera/index.js";
import { analyze } from "./posture/index.js";
import { voiceCoach } from "./voice/index.js";
import { maizy } from "./maizy/index.js";
import { ui } from "./ui/index.js";

await startCamera(document.querySelector("#camera-video"), document.querySelector("#camera-overlay"));

onPoseFrame((frame) => {
  const state = analyze(frame);      // Darren
  ui.update(state);                  // Darren
  maizy.update(state);               // Shawn
  voiceCoach.update(state);          // Joseph
  window.api.setTrayScore(state.score);
});
```

Each module is a plain JS file that exports functions. Nobody needs anyone else's code to start, because everyone builds against **fake data** shaped like the contracts below.

---

## 3. Shared contracts (the most important section)

> In hour 0, Darren copies this into `src/shared/contracts.js`. If you want to change a contract, say so in the group chat first. Darren updates the file and this section, and everyone pulls.

### 3.1 `PoseFrame`: Track 1 → Track 2

```js
/**
 * @typedef {Object} Landmark
 * @property {number} x           0–1, fraction of video width (0 = left edge of the RAW, un-mirrored image)
 * @property {number} y           0–1, fraction of video height (0 = top)
 * @property {number} z           rough depth estimate. Noisy, so avoid it
 * @property {number} visibility  0–1, how confident MediaPipe is that this point is visible
 */

/**
 * @typedef {Object} PoseFrame
 * @property {number} timestamp            ms, from performance.now()
 * @property {number} width                video width in pixels (video.videoWidth)
 * @property {number} height               video height in pixels (video.videoHeight)
 * @property {Landmark[] | null} landmarks 33 points in MediaPipe order, or null if nobody is in frame
 */
```

Landmark indices we care about. "Left" means the **person's** left.

| Index | Point | Index | Point |
|---|---|---|---|
| 0 | nose | 7 | left ear |
| 2 | left eye | 8 | right ear |
| 5 | right eye | 11 | left shoulder |
| 9, 10 | mouth corners | 12 | right shoulder |

### 3.2 Issue IDs (everyone uses these exact strings)

```js
export const ISSUES = {
  forward_head:     { medical: "Forward head posture",          layman: "Neck too far forward" },
  slouching:        { medical: "Postural kyphosis",             layman: "Hunched over" },
  head_tilt:        { medical: "Lateral cervical flexion",      layman: "Head tilted to one side" },
  uneven_shoulders: { medical: "Shoulder elevation asymmetry",  layman: "One shoulder higher than the other" },
  too_close:        { medical: null,                            layman: "Too close to the screen" },
};
```

These IDs connect everything:
- Joseph's voice lines and stretches are keyed by them.
- Shawn's Maizy warning glows are keyed by them.
- The UI looks up display names from them.

### 3.3 `PostureState`: Track 2 → everyone

```js
/**
 * @typedef {Object} Issue
 * @property {keyof ISSUES} id
 * @property {string|null} medical
 * @property {string} layman
 * @property {number} severity     0–1 (0 = fine, 1 = as bad as we measure)
 * @property {number} durationSec  how long this issue has been going on
 * @property {boolean} sustained   true once it has lasted past the alert threshold (~5 s). Only alert on sustained issues!
 */

/**
 * @typedef {Object} PostureState
 * @property {number}  timestamp
 * @property {boolean} present              someone is in frame
 * @property {boolean} calibrated           a baseline exists
 * @property {boolean} calibrating          calibration is running right now
 * @property {number}  calibrationProgress  0–1 while calibrating
 * @property {number|null} score            0–100 (100 = matches your calibrated posture); null if not present or not calibrated
 * @property {Issue[]} issues               issues detected right now (may be empty)
 * @property {Object}  metrics              raw numbers for debugging and for Maizy (Darren documents the fields)
 */
```

### 3.4 Module APIs

| Module | Owner | Exports |
|---|---|---|
| `src/camera/index.js` | Jordan | `startCamera(videoEl, canvasEl) → Promise`, `stopCamera()`, `onPoseFrame(cb) → unsubscribe`, `setOverlayVisible(bool)`, `listCameras() → Promise<{ deviceId, label }[]>`, `switchCamera(deviceId)`, `currentCameraId()`, `describeCameraError(err) → string` |
| `src/posture/index.js` | Darren | `analyze(frame) → PostureState`, `startCalibration(ms = 3000) → Promise<{ ok, reason? }>`, `resetCalibration()`, `setSensitivity(0–1)` |
| `src/voice/index.js` | Joseph | `voiceCoach.update(state)`, `voiceCoach.setMuted(bool)`, `speakLine(lineId) → Promise`, `notify(title, body)` (shows a notification and reads it aloud) |
| `src/voice/agent/maizy-agent.js` | Joseph | `createMaizyAgent(...) → { update(state), start(reason), end(), setAutoWake(bool), onChange(cb) }`: the live Maizy voice agent |
| `src/voice/agent/app-controls.js` | Joseph | `createAppControls(root) → { list(), press(id) }`: lets Maizy press the app's buttons when asked |
| `src/voice/wake-word.js` | Joseph | `createWakeWord(...) → { start(), stop(), onState(cb) }`: listens for "Hey Maizy" on the computer |
| `src/stretches/index.js` | Joseph | `STRETCHES` (data array), `stretchesFor(issueId) → Stretch[]`, `startStretch(id)`, `stopStretch()`, `onStretchEvent(cb) → unsubscribe` |
| `src/maizy/index.js` | Shawn | `maizy.mount(el)`, `maizy.update(state)`, `maizy.celebrate()`, `maizy.setVitality(0–1 \| null)` |
| `src/debug/fake-posture.js` | Shawn | `mountFakePosturePanel(el, onState)`: sliders and checkboxes that emit fake `PostureState`s |
| `src/ui/index.js` | Darren | `ui.mount(el)`, `ui.update(state)` |

Stretch events: `{ type: "start" | "step" | "tick" | "end", stretchId, stepIndex, secondsLeft }`.

### 3.5 `window.api`: the bridge to the Electron main process (Shawn builds it, everyone uses it)

```js
window.api.tts(text)           // → Promise<Uint8Array> of mp3 bytes from ElevenLabs (the key stays in the main process)
window.api.notify(title, body) // native desktop notification (Mac or Windows); call voice.notify instead so it's also read aloud
window.api.maizySignedUrl()    // → Promise<string>, a short-lived link for one call with Maizy (the key stays in main)
window.api.setTrayScore(score) // number, or null to show "–" in the tray (Mac menu bar / Windows taskbar)
window.api.setMaizyStatus(s)   // { call, wake, listenOn }: the Maizy dot and menu items in the tray
window.api.onTrayCommand(cb)   // cb("pause" | "resume" | "recalibrate" | "show" | "talk" | "end-call" | "toggle-listen")
```

### 3.6 Changing a contract
1. Post in the group chat what you want to change and why.
2. Darren updates `src/shared/contracts.js` and Section 3 of this file, then pushes.
3. Everyone pulls. Small, early changes are fine. After hour 14, only change a contract if something is broken.

---

## 4. Stack, setup & folder layout

### Stack

| What | Tool | Why |
|---|---|---|
| Desktop app | **Electron** via **Electron Forge, Vite template** | A real desktop app for Mac and Windows from one codebase, built with web tech; same approach as Slack and VS Code |
| Language | **Plain JavaScript** (ES modules) | One language for everything, and no compile step to fight |
| Pose detection | **`@mediapipe/tasks-vision`**, `PoseLandmarker` (lite model) | Runs locally and fast; gives 33 body points |
| Drawing | `<video>` + `<canvas>` | Built into the browser |
| Voice | **ElevenLabs Text-to-Speech REST API** | High-quality voice with a simple HTTP call |
| Version control | Git + GitHub | One branch per person |

### Everyone installs (hour 0)
- **Node.js 20 or newer** (LTS). Check with `node -v`.
- **Git**, plus access to the GitHub repo.
- **VS Code** (or any editor) and an AI coding assistant.

### Hour 0 setup, by person

| Who | Does |
|---|---|
| **Shawn** | Scaffold the app with Electron Forge's Vite template (`npx create-electron-app@latest <name> --template=vite`). If it complains the repo folder isn't empty, scaffold in a temp folder and move the files in. Create the empty folders below, add `.env` to `.gitignore`, add `.env.example`, check `npm start` opens a window, then push. Target: 30–45 minutes. |
| **Darren** | Create `src/shared/contracts.js` from Section 3 and push it. Make the group chat. Fill in the real clock times in Section 6. |
| **Jordan** | While waiting, read the MediaPipe Pose Landmarker guide and try the online demo (links in Track 1). |
| **Joseph** | Make an ElevenLabs account, create an API key, and pick a voice. Put the key in your local `.env` only. |
| **Everyone** | Once Shawn pushes: `git clone`, `npm install`, `npm start`, then make your branch. |

### Running things
- **The real app:** `npm start` opens the Electron window.
- **Your solo playground:** every folder gets its own `dev.html` test page. Run `npx vite` from the repo root, then open `http://localhost:5173/src/<your-folder>/dev.html` in Chrome. You can work there without touching the app, and without waiting for anyone.

### Mac and Windows

The app must run on both. Electron, MediaPipe, the posture math, the voice and Maizy all work the same on both systems, so **almost all code is shared**. The few differences are OS features, and they all live in Shawn's files (`src/main.js`, `forge.config.mjs`):

| Feature | Mac | Windows |
|---|---|---|
| Score in the tray | `tray.setTitle("72")` shows text in the menu bar | `setTitle` does nothing. Draw the score onto the tray icon image (e.g. render it on a small canvas), and also set `tray.setToolTip("Posture: 72")` |
| Camera permission | Call `systemPreferences.askForMediaAccess("camera")` from the main process | That function is Mac-only. Windows uses Settings → Privacy & security → Camera. Just call `getUserMedia`, and if it fails, show a message telling the user to allow camera access there |
| Permission text when packaged | `NSCameraUsageDescription` in `forge.config.mjs` | Not needed |
| Notifications | Work out of the box | Call `app.setAppUserModelId("com.stretchgoals.app")` at startup, or notifications may not appear |
| Closing the window | Hide it and keep running (the app stays in the menu bar) | Same: hide to the tray icon, and quit from the tray menu |
| Packaging | `npm run make` → `.app` (zip) | `npm run make` → installer `.exe`. **Must be built on a Windows machine** |

**Rules for everyone:**
- Write OS-specific code only behind `if (process.platform === "darwin")` (Mac) or `"win32"` (Windows), and only in Shawn's files.
- Build file paths with `path.join(...)` in Node code, never by gluing strings with `/`.
- **Demo on whichever laptop you present with**, and make sure that OS is fully tested.
- If anyone has a Windows laptop, they run `npm start` at every checkpoint to catch problems early. If nobody does, Windows is "should work" and we say so honestly.
- Commands in this guide (`npm start`, `npx vite`, `node --env-file=.env …`) are the same on Windows (use PowerShell or the VS Code terminal).

### Folder layout

```
stretchGoals/
├── TEAM_GUIDE.md            ← this file
├── .env                     ← ELEVENLABS_API_KEY=...   (NEVER committed)
├── .env.example             ← ELEVENLABS_API_KEY=      (committed, no value)
├── forge.config.mjs         ← Shawn
├── package.json
├── data/recordings/         ← Jordan: recorded PoseFrames (JSON, numbers only, no images)
└── src/
    ├── main.js              ← Shawn: Electron main process (window, tray, notifications, ElevenLabs calls)
    ├── preload.js           ← Shawn: exposes window.api
    ├── app.js               ← Shawn: wires the modules together
    ├── notifications.js     ← Shawn: desktop notifications for sustained issues
    ├── shared/contracts.js  ← Darren
    ├── camera/              ← Jordan   (index.js, dev.html)
    ├── posture/             ← Darren   (index.js, dev.html, replay.mjs)
    ├── voice/               ← Joseph   (index.js, dev.html, lines.js, audio/)
    ├── stretches/           ← Joseph   (index.js, dev.html)
    ├── maizy/               ← Shawn    (index.js, maizy.css, dev.html, maizy-strip.webp)
    ├── debug/               ← Shawn    (fake-posture.js)
    └── ui/                  ← Darren
```

The Forge template may name some files differently, for example `renderer.js` instead of `app.js`. Shawn updates this tree to match.

---

## 5. Team practices

### Ownership
- **Own your folder.** Only edit files you own. If you need something from another track, ask its owner. If you need a test button, put it in your own `dev.html`, not in `src/ui/`.
- **Fake it until it's real.** Build against fake data shaped exactly like the contracts. When the real module lands, swapping it in should be a one-line change.

### Git
- **Branches:** `jordan/camera`, `darren/posture`, `joseph/voice`, `shawn/app`.
- **Commits:** small and often, with messages that say what changed ("draw shoulder line on overlay").
- **Merging:** pull `main` into your branch at each checkpoint. Shawn merges branches into `main` at the checkpoints.
- **Never** force-push `main`.

### Secrets & privacy
- The ElevenLabs key lives only in `.env`, which is git-ignored, and is read only by `src/main.js`.
- Never save video or images to disk. Landmark recordings are numbers only, and that's fine.
- The only data that leaves the laptop is the text we send to ElevenLabs.

### Keep it simple
- Plain JS, no TypeScript, no frameworks inside modules.
- Ask in chat before adding an npm package.
- The demo matters more than clean code. Code still needs to be readable enough that a teammate can fix it at 4am.

### Communication
- **Standup every 2 hours, 5 minutes max.** Each person covers what's done, what's next, and whether they're blocked.
- **Stuck for 20–30 minutes?**
  1. Ask your AI assistant for a fuller answer.
  2. Still stuck after another 15 minutes? Ask a teammate.
  3. Don't suffer silently.
- **Contract changes** go through the group chat (see 3.6).

### Learning
This is a learning hackathon. When your AI assistant gives you code, make sure you can explain each part. At each standup, take 30 seconds to share one thing you learned. By the end, everyone should be able to explain the whole pipeline.

---

## 6. Timeline & checkpoints

Kickoff clock time: **____** (Darren fills in). Hour 0 is kickoff.

| Hours | Jordan (camera) | Darren (posture) | Joseph (voice) | Shawn (app & Maizy) |
|---|---|---|---|---|
| 0–1 | Kickoff, read docs | Write contracts, kickoff | ElevenLabs account, kickoff | **Scaffold the repo** |
| 1–3 | Webcam + MediaPipe in `dev.html` | Math on paper, fake landmarks | Hello-world TTS from a Node script | **Fake posture panel**, camera inside Electron |
| 3–5 | Overlay drawing, **record landmark files** | Metrics + calibration on recordings | Write voice lines, pre-generate audio | IPC bridge (`window.api`), tray score |
| 5–8 | 10-per-second loop, `onPoseFrame`, no-person handling | Smoothing, issues, score; `replay.mjs` | `voiceCoach` rules, cooldowns | Maizy v1 (10-frame flipbook), wire up `app.js` |
| **8** | **Checkpoint 1: everyone merges** | | | |
| 8–14 | Bundle MediaPipe locally, camera controls | Tune thresholds with the team slouching | Stretch data + guided stretch flow | Notifications, background running, first test build |
| **14** | **Checkpoint 2: full loop works** | | | |
| 14–20 | Bug fixing, help Darren tune | Tuning, sensitivity setting | Polish voice, Agents stretch goal | Packaging (Mac `.app`, Windows installer if a Windows laptop is available), Windows fixes, integration fixes |
| **20** | **Feature freeze. Bug fixes only after this.** | | | |
| 20–24 | Build the packaged app, record a backup demo video, rehearse 3 times, prepare the pitch | | | |

### Checkpoint 1 (hour 8): "it's alive"
- [ ] `npm start` opens the app and shows the live camera with dots on the body.
- [ ] Real `PoseFrame`s flow into `analyze()`, and the score visibly drops when someone slouches, even if the numbers are rough.
- [ ] Maizy reacts to `PostureState`, from fake or real data.
- [ ] One voice line plays inside the app.
- [ ] The tray shows the score (menu bar on Mac; icon or tooltip on Windows).
- [ ] If a Windows laptop is available: `npm start` works on it too.

### Checkpoint 2 (hour 14): "the demo works"
- [ ] Calibrate → slouch → issue detected after about 5 seconds → Maizy slouches → voice and notification fire once.
- [ ] Start the suggested stretch → guided by the voice and the stretch screen.
- [ ] Sit up → score recovers → Maizy celebrates.
- [ ] Detection keeps running when the window is hidden.

### Freeze (hour 20)
- [ ] The packaged app for the demo laptop's OS launches on a fresh start and gets camera access.
- [ ] If possible, the other OS's package is built and tested too.
- [ ] Backup demo video recorded.

---

## 7. Track guides

Each guide covers:
- your mission and what you'll learn
- how to start with zero dependencies
- milestones, each with a clear "done when"
- gotchas, resources, and what to do if you finish early

If a link has moved, search for its title.

---

### Track 1: Camera & Pose ("the eyes"), Jordan

**Mission:** turn the webcam into a steady stream of body points (`PoseFrame`s), and draw those points over the video.

**You'll learn:** how browsers access cameras, the `<video>` and `<canvas>` elements, running an ML model in real time, and coordinate systems.

**Start right away:** nothing to wait for. Work in `src/camera/dev.html` with `npx vite`.

**Milestones**
1. **Webcam on screen.** Use `getUserMedia` and a `<video>` element, mirrored with CSS `transform: scaleX(-1)`. *Done when:* you can see yourself.
2. **MediaPipe running.** Load `PoseLandmarker` with the **lite** model in `"VIDEO"` mode. *Done when:* the nose's `x, y` prints in the console and changes as you move.
3. **Overlay.** Put a `<canvas>` exactly on top of the video and set `canvas.width = video.videoWidth` (same for height). Draw dots for points 0, 2, 5, 7, 8, 11 and 12, plus lines from each ear to its shoulder and from shoulder to shoulder. Skip points with `visibility < 0.5`. Mirror the canvas the same way as the video. *Done when:* the dots stick to your body.
4. **Recordings for Darren.** This is the team's first unblocker, so aim for it by about hour 4. Add a "Record 30s" button that collects `PoseFrame`s into an array and downloads it as JSON. Record each file below and commit them to `data/recordings/`:
   - `upright.json`: sit up straight
   - `forward_head.json`: push your chin toward the screen
   - `slouch.json`: collapse into the chair
   - `head_tilt_left.json`, `head_tilt_right.json`
   - `uneven_shoulders.json`: lean on one elbow
   - `too_close.json`: lean in toward the screen
   - `transition.json`: upright for 10 s, slouch for 10 s, upright for 10 s
   - `empty.json`: walk out of the frame

   *Done when:* the files are in the repo and Darren has them.
5. **The real module.** Turn it into `src/camera/index.js` with the API from 3.4. *Done when:* `onPoseFrame` delivers frames about 10 times a second, with `landmarks: null` when nobody is there.
6. **Bundle MediaPipe locally.** Copy the `wasm` folder from `node_modules/@mediapipe/tasks-vision/` and download the `.task` model file into the app's static assets, then load them from there. This makes the app work offline and inside the packaged app on both Mac and Windows. Work with Shawn on paths. *Done when:* the app works with Wi-Fi off.
7. **Camera controls.** `stopCamera()`, `setOverlayVisible()`, and a camera picker using `navigator.mediaDevices.enumerateDevices()`. The picker matters more on Windows: many Windows laptops list an infrared "Windows Hello" camera, and if the app grabs that one the picture is black and grey.
8. **Friendly camera errors.** If `getUserMedia` fails, show a clear message instead of crashing. Common causes: the user denied permission (on Windows, check Settings → Privacy & security → Camera), or another app like Zoom or Teams is using the camera.

**Starter shape** (fill in the drawing and the paths yourself):

```js
// src/camera/index.js
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let landmarker, video, canvas, timer;
const listeners = new Set();

export async function startCamera(videoEl, canvasEl) {
  video = videoEl;
  canvas = canvasEl;
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  await video.play();

  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);      // CDN at first, local files later
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  timer = setInterval(detect, 100); // ~10 per second (see the gotcha about requestAnimationFrame)
}

function detect() {
  const now = performance.now();
  const result = landmarker.detectForVideo(video, now);
  const frame = {
    timestamp: now,
    width: video.videoWidth,
    height: video.videoHeight,
    landmarks: result.landmarks[0] ?? null,
  };
  // drawOverlay(frame);  ← you write this
  listeners.forEach((cb) => cb(frame));
}

export function onPoseFrame(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
```

**Gotchas**
- **Use `setInterval`, not `requestAnimationFrame`.** The browser pauses `requestAnimationFrame` when the window is hidden, and this app has to keep watching in the background.
- `getUserMedia` only works on `localhost`, `https`, or inside Electron. Opening the HTML file directly from Finder or File Explorer won't work.
- Landmark `x` and `y` are 0–1 fractions. Multiply by the canvas width and height to draw them.
- Mirror the video and the canvas, but **never mirror the data** you send to Darren.
- MediaPipe's "left" means the person's left, which appears on the right side of the raw image.
- `detectForVideo` needs timestamps that keep increasing. `performance.now()` takes care of that.
- Bad lighting gives jumpy points. Test facing a light, not with a window behind you.

**Resources**
- MediaPipe Pose Landmarker overview, including the landmark map: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- Web/JavaScript guide: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Try it in the browser (MediaPipe Studio): https://mediapipe-studio.webapps.google.com/demo/pose_landmarker
- MDN `getUserMedia`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- MDN Canvas tutorial: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial

**If you finish early:** help Darren tune thresholds by slouching in front of the camera a lot. Then add a smooth "skeleton glow" style to the overlay, or show a "no one detected" state.

---

### Track 2: Posture Brain ("the doctor"), Darren

**Mission:** turn body points into judgments: calibrate to the user, measure how far off they are, name the issue, and produce a 0–100 score that doesn't flicker.

**You'll learn:** 2D geometry on real data, normalizing measurements, smoothing noisy signals, thresholds with hysteresis, and testing logic against recorded data.

**Start right away:**
- Work out the math on paper.
- Write a helper that builds fake `PoseFrame`s, e.g. `makeFakeFrame({ neckDrop: 0.2 })`.
- Look at real points in MediaPipe Studio (link in Track 1).
- Switch to Jordan's recordings when they arrive, around hour 4.

**Keep `src/posture/` free of any DOM or browser code.** Then it runs in Node too, and `node src/posture/replay.mjs data/recordings/slouch.json` can print a score timeline without opening the app.

#### The measurements

First convert to pixels, because width and height are scaled differently: $X = x \cdot \text{width}$ and $Y = y \cdot \text{height}$. Use these points:
- $E$ = midpoint of the ears (points 7 and 8)
- $S$ = midpoint of the shoulders (points 11 and 12)
- $w$ = distance between the shoulders, which works as a ruler that cancels out how far the person sits from the camera

| Metric | Formula | Changes when… |
|---|---|---|
| `neckRatio` | $(S_y - E_y) / w$ | **drops** when the head drops or juts forward, or the person slouches |
| `headRatio` | (ear-to-ear distance) ÷ $w$ | **rises** when the head moves forward of the shoulders |
| `headTiltDeg` | angle of the ear-to-ear line | moves away from baseline when the head tilts |
| `shoulderTiltDeg` | angle of the shoulder-to-shoulder line | moves away from baseline when the shoulders are uneven |
| `closeness` | $w / w_0$ | **rises** when the person leans in toward the screen |
| `shoulderDrop` | $(S_y - S_{y,0}) / \text{height}$ | **rises** when the person sinks in the chair |

Variables with a 0 subscript are baseline values from calibration. Get angles with `Math.atan2(dy, dx) * 180 / Math.PI`.

A front-facing camera can't see the neck from the side, so these are **indirect** signals. The thresholds below are starting guesses. Tune them with the recordings and the team.

| Issue | Starting rule |
|---|---|
| `forward_head` | `neckRatio` more than 12% below baseline, **or** `headRatio` more than 8% above |
| `slouching` | `shoulderDrop` above 0.04 **and** `neckRatio` below baseline |
| `head_tilt` | `headTiltDeg` more than 8° from baseline |
| `uneven_shoulders` | `shoulderTiltDeg` more than 5° from baseline |
| `too_close` | `closeness` above 1.2 |

#### Turning measurements into severity and a score

For each metric, compare the current value $x$ with its baseline $x_0$:

$$
d = \frac{x - x_0}{x_0}
$$

Map the deviation to a 0–1 severity, with a "fine" zone $d_{\text{ok}}$ and a "maxed out" point $d_{\text{max}}$:

$$
\text{severity} = \text{clamp}\left( \frac{\lvert d \rvert - d_{\text{ok}}}{d_{\text{max}} - d_{\text{ok}}},\ 0,\ 1 \right)
$$

Combine the severities into the score, with weights $w_i$ for how much each issue matters:

$$
\text{score} = 100 \cdot \left( 1 - \min\left( 1,\ \sum_i w_i \cdot \text{severity}_i \right) \right)
$$

#### Making it steady

**Smoothing.** Use an exponential moving average on each metric. With roughly 10 frames per second, start around $\alpha = 0.2$:

$$
\bar{x}_t = \alpha x_t + (1 - \alpha) \bar{x}_{t-1}
$$

**Hysteresis.** Stops issues from flickering on and off:
- An issue **starts** when severity goes above 0.3. Count `durationSec` from then.
- It becomes `sustained` after 5 seconds. Other tracks only alert on sustained issues.
- It **ends** only after severity stays below 0.15 for 2 seconds.

**Calibration.**
- `startCalibration(3000)` collects frames for 3 seconds and takes the **median** of each metric as the baseline. The median ignores the odd glitchy frame.
- **Reject** the calibration (`{ ok: false, reason }`) if:
  - nobody is visible
  - key points have low visibility
  - the person moved a lot (high spread in the values)
- Save the baseline to `localStorage` so it survives a restart, with a fallback for when it isn't available.

**Missing points.** Hair can hide ears. If ear visibility is below 0.5, fall back to the eyes (points 2 and 5) for head measurements. If shoulders aren't visible, return `present: true` with `score: null` rather than guessing.

**Milestones**
1. Fake-frame helper + metrics computed. *Done when:* the numbers move in the right direction for fake frames.
2. Calibration with median + reject rules. *Done when:* it works on `upright.json`.
3. `replay.mjs` prints `time | score | issues` for any recording. *Done when:* `upright` stays above 90, `slouch` and `forward_head` get flagged within about 6 seconds, and `empty` gives `present: false`.
4. Smoothing + hysteresis + `sustained`. *Done when:* `transition.json` shows a clean drop and recovery with no flicker.
5. Live tuning with the team at checkpoint 1. Have each person sit naturally, slouch, and tilt.
6. `setSensitivity(0–1)`, which scales the thresholds for the settings screen.

**Resources**
- Landmark map (same link as Track 1).
- MDN `Math.atan2`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/atan2
- Search "exponential moving average explained" and "hysteresis thresholding" for 5-minute intros.

**If you finish early:** fill in `metrics` with values Maizy can use directly, e.g. `metrics.headForward` from 0 to 1 and `metrics.headTiltDeg` with a sign, so Maizy copies the exact angle. Then add a "minutes in good posture today" counter.

---

### Track 3: Voice Coach & Stretches ("the coach"), Joseph

**Mission:** give the app a voice that helps without nagging, and a set of guided stretches matched to each issue.

**You'll learn:** calling a REST API with authentication, handling audio in JavaScript, keeping secrets safe, writing rules for when to speak, and writing for voice.

**Start right away:** a plain Node script can call ElevenLabs without Electron. Use a fake-state button in `src/voice/dev.html` to trigger voice lines.

**Milestones**

1. **Hello world.** Put `ELEVENLABS_API_KEY=...` in `.env`, pick a voice and copy its voice ID from the ElevenLabs dashboard, then run a script. *Done when:* `hello.mp3` plays.

   ```js
   // src/voice/try-tts.mjs     run with:  node --env-file=.env src/voice/try-tts.mjs
   import { writeFile } from "node:fs/promises";

   const VOICE_ID = "paste-your-voice-id";
   const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
     method: "POST",
     headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
     body: JSON.stringify({ text: "Hey! Your neck is drifting forward.", model_id: "eleven_flash_v2_5" }),
   });
   if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
   await writeFile("hello.mp3", Buffer.from(await res.arrayBuffer()));
   ```

2. **Write the lines** in `src/voice/lines.js`, keyed by issue ID, with 3–4 versions each so it doesn't sound robotic. Say both names. For example:
   > "Heads up: forward head posture. In plain words, your neck's too far out. Try tucking your chin back."

   Also write lines for:
   - calibration ("Sit up nice and tall… hold it… got it!")
   - praise when an issue is fixed
   - stretch steps
   - countdowns ("five… four…")

3. **Pre-generate the audio.** A script turns every fixed line into `src/voice/audio/<lineId>.mp3`. That saves ElevenLabs credits, removes delay, and **works offline at the demo**. Only use live TTS for dynamic text. *Done when:* `speakLine(lineId)` plays a local file instantly.
4. **`voiceCoach.update(state)` rules:**
   - Speak only for `sustained` issues.
   - Wait at least 3 minutes before repeating the same issue, and at least 60 seconds between any two lines.
   - Give no posture alerts during calibration or a stretch. The stretch's own guidance still plays.
   - Respect mute.
   - Say a short praise line when an issue you warned about goes away.

   Agree with Shawn on who fires the desktop notification, so the voice and the notification don't double up. One option: voice when the window is open, notification when it's hidden. *Done when:* clicking fake states in `dev.html` produces sensible, non-annoying behavior.
5. **Stretches.** Fill in the `STRETCHES` array and build `startStretch(id)`. It walks through the steps with voice and a timer, and emits stretch events so the UI can follow along.
6. **Live TTS in the app.** Once Shawn's `window.api.tts(text)` exists (around checkpoint 1), use it for dynamic lines. Play the result with `new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }))).play()`.
7. **Stretch goal: ElevenLabs Agents** (conversational voice). The user could ask "what stretch should I do?" out loud. Only start this after checkpoint 2.

**Starting stretch list.** Keep them gentle, done while seated, and 30–60 seconds each.

| id | Name | Helps | How |
|---|---|---|---|
| `chin_tuck` | Chin tucks | `forward_head` | Sit tall and slide your chin straight back (a "double chin"). Hold 5 s, 8–10 reps |
| `upper_trap` | Ear-to-shoulder stretch | `head_tilt`, neck tension | Tip your ear toward your shoulder. Hold 20–30 s each side |
| `levator` | Look-to-armpit stretch | neck tension | Turn your nose toward your armpit and look down. Hold 20–30 s each side |
| `chest_opener` | Seated chest opener | `slouching` | Clasp your hands behind your back, squeeze your shoulder blades, lift your chest. Hold 20 s |
| `scap_squeeze` | Shoulder blade squeeze | `slouching`, `uneven_shoulders` | Squeeze your shoulder blades together and down. Hold 5 s, 10 reps |
| `shoulder_rolls` | Shoulder rolls | `uneven_shoulders` | Roll your shoulders backward slowly, 10 times |
| `seated_extension` | Seated back extension | `slouching` | Hands behind your head, gently arch back over the top of the chair. 5 reps of 5 s |
| `eye_break` | 20-20-20 break | `too_close` | Sit back and look at something 20 feet away for 20 seconds |

Add a line to the UI and the voice intro: *"Move gently and stop if anything hurts. This isn't medical advice."*

**Gotchas**
- Never put the key in `src/voice/` code that runs in the window. In the app, ElevenLabs calls go through `window.api.tts`, which runs in Shawn's main process.
- The free tier has a limited number of characters, so pre-generate audio and don't call the API in a loop.
- Browsers can block audio until the user has clicked something. The calibration button click covers that.

**Resources**
- ElevenLabs docs: https://elevenlabs.io/docs
- Text-to-Speech API reference: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- MDN `HTMLAudioElement`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLAudioElement

**If you finish early:** give the voice a personality (Maizy's voice?), add a "stretch break every 45 minutes" reminder, or try ElevenLabs Agents.

---

### Track 4: Desktop App & Maizy ("the body"), Shawn

**Mission:** make it a real desktop app for Mac and Windows, with a tray score, notifications, background running, and packaging. Bring Maizy to life, and act as integration lead. You own all the Mac-vs-Windows differences (see "Mac and Windows" in Section 4).

**Branch:** `task4`. Teammates can get the latest app shell with `git pull origin task4`, then `npm install`.

**Status**

| # | Milestone | Status |
|---|---|---|
| 0 | Scaffold | ✅ Done |
| 1 | Fake posture panel | ✅ Done |
| 2 | Camera in Electron | ✅ Done |
| 3 | IPC bridge (`window.api`) | ✅ Done |
| 4 | Tray score and menu | ✅ Done |
| 5 | Maizy | ✅ Done |
| 6 | Wire `app.js` | ✅ Done |
| 7 | Notifications | ✅ Done |
| 8 | Background running | ✅ Done |
| 9 | Packaging | ✅ Done on Mac (rebuild after merging teammates' updates); Windows needs a Windows laptop |

Maizy doesn't do stretches; the voice and the UI's stretch screen guide them.

**You'll learn:** Electron's main and renderer processes, IPC, OS integration (tray, notifications, permissions) on two operating systems, flipbook (sprite sheet) animation, and packaging and shipping an app.

**Try it:** `npm start` opens the app. `STRETCHGOALS_DEBUG=1 npm start` also opens DevTools and the fake posture panel below the app, which can drive Maizy and the tray score. Playgrounds (`npx vite`): `/src/debug/dev.html` (fake panel), `/src/maizy/dev.html` (Maizy).

**Milestones**
0. ✅ **Scaffold.** Electron Forge with the Vite template. Each track has its folder; `.env` is git-ignored and `.env.example` lists `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` and `ELEVENLABS_AGENT_ID`. The Forge config is `forge.config.mjs`.
1. ✅ **Fake posture panel** (`src/debug/fake-posture.js`). A score slider, and for each issue an "active" checkbox, a severity slider and a "sustained" toggle. It sends a `PostureState` on every change and 10 times a second. Use it with `mountFakePosturePanel(el, (state) => yourModule.update(state))`.
2. ✅ **Camera in Electron.** `main.js` asks macOS for camera permission before the window opens. The UI's Start camera button calls Jordan's `startCamera()` and shows a friendly message if the camera is blocked or busy. Windows has no prompt; the message points to Settings → Privacy & security → Camera.
3. ✅ **IPC bridge.** `preload.js` exposes six functions on `window.api` (contract 3.5): the four below, plus Joseph's `maizySignedUrl` (the Maizy voice agent's call link, key stays in main) and `setMaizyStatus` (Maizy's tray items). `tts` calls ElevenLabs from the main process with the key from `.env` (same model and voice settings as Joseph's scripts, 500 characters max); `notify` shows a desktop notification; `setTrayScore` updates the tray; `onTrayCommand` tells the window when a tray item is clicked.
4. ✅ **Tray.** A person icon in the menu bar with the score next to it (`tray.setTitle` on Mac; on Windows `setTitle` does nothing, so the score is in the tooltip and left-click opens the window). The menu has Show window, Pause/Resume, Recalibrate and Quit; clicks reach the window through `onTrayCommand` (`pause`, `resume`, `recalibrate`, `show`). Joseph added Maizy's status line, Talk to Maizy / End call and a "Listen for Hey Maizy" checkbox, with a dot before the score while she listens (•) or talks (◉).
5. ✅ **Maizy.** A 10-frame flipbook the team drew (`src/maizy/maizy-strip.webp`), from fully slumped to standing tall. `maizy.update(state)` picks a frame from the posture score (one frame per 10 points), walks to it one frame at a time, and adds breathing, sway, sparkles from 95, a red glow on sustained issues and an away state. She cheers when you fix an issue. She mounts into `<div id="maizy">`; her background is transparent, so she works in light and dark mode.
6. ✅ **Wire `app.js`.** The UI mounts into `#app` (its Start button starts the camera), Maizy into the UI's `#maizy` slot. Every PoseFrame goes through `posture.analyze()`, then to the UI, Maizy, the voice coach, notifications and the tray. Pause (UI or tray) stops it all; tray Recalibrate opens calibration. `app.js` sorts issues worst first before passing them on. In debug mode (`STRETCHGOALS_DEBUG=1 npm start`), tick "Use fake posture" under the app to drive everything from the fake panel instead of the camera.
7. ✅ **Notifications** (`src/notifications.js`). `postureNotifier.update(state)` shows a desktop notification for a sustained issue only when you're not looking at the app (window hidden, minimised or behind other apps); while you're looking, Maizy and the voice handle it. Cooldowns: the same issue can repeat after 10 seconds, but never sooner than 60 seconds after any notification, so a lasting issue gets a reminder about once a minute. The title is the medical name, the body the plain name plus a quick fix. Tray Pause stops them, and clicking a notification opens the app. `app.setAppUserModelId` is set for Windows. It sends them through `voice.notify`, so the coach reads each one aloud, and the coach skips its own nudge while you are away so nothing is said twice.

   Testing notifications: use the packaged app, not `npm start`. macOS doesn't show notifications from the dev "Electron" app, because it isn't registered in System Settings → Notifications. Run `npm run package`, open `out/stretchGoals-darwin-arm64/stretchGoals.app`, and allow notifications when asked.
8. ✅ **Background running.** Closing the window hides it instead of quitting, so posture tracking continues from the tray. Tray → Quit or Cmd+Q really quits. `backgroundThrottling: false` keeps timers at full speed while the window is hidden, and on Mac the dock icon brings the window back.
9. ✅ **Packaging** with `npm run make`. It builds for the OS you run it on: a `.app` on a Mac, an installer `.exe` on Windows. To ship both, run it once on each.

    **Mac (done):** `npm run make` creates `out/stretchGoals-darwin-arm64/stretchGoals.app` and a zip to share in `out/make/zip/darwin/arm64/`. `forge.config.mjs` sets the app's own ID (`com.stretchgoals.app`), the camera and microphone permission texts (`NSCameraUsageDescription`, without it the camera shows black; `NSMicrophoneUsageDescription` for "Hey Maizy"), and re-signs the finished app (ad-hoc, no Apple certificate) so macOS allows its notifications. Jordan's MediaPipe files (`public/mediapipe/`) are packed in, so it works with Wi-Fi off. DevTools and the fake posture panel only appear with `STRETCHGOALS_DEBUG=1 npm start`, never in the packaged app.
    - The app isn't signed with an Apple certificate, so the first launch needs right-click → Open.
    - **Voice:** the packaged app reads its ElevenLabs key from `~/Library/Application Support/stretchGoals/.env` (copy your project's `.env` there). The key is never packed into the app.

    **Windows:** the Forge template's default Windows maker (Squirrel) produces a `Setup.exe`. It isn't signed, so Windows SmartScreen will warn: click "More info" → "Run anyway". The voice key goes in `%APPDATA%\stretchGoals\.env`.

    *Done when:* the packaged app for the demo laptop launches normally, gets the camera, and works with Wi-Fi off.

**Maizy tip:** the score picks the frame, so Maizy mirrors *how much* you're slouching. The strip is one long image; a frame-sized window shows one frame, and sliding the strip changes it:

```js
const frame = Math.min(9, Math.floor(state.score / 10)); // 0 = slumped, 9 = tall
strip.style.transform = `translateX(${-frame * frameWidth}px)`;
```

She moves up a frame as soon as the score reaches the next band, but only moves down once it's clearly lower, so a borderline score doesn't make her flicker.

**Integration lead duties:**
- At each checkpoint, pull everyone's branches into `main` and run `npm start`.
- If something doesn't fit together, check it against Section 3 and tell the owner.

**Resources**
- Electron tutorial: https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites
- Electron Forge, Vite template: https://www.electronforge.io/templates/vite
- IPC guide: https://www.electronjs.org/docs/latest/tutorial/ipc
- Tray: https://www.electronjs.org/docs/latest/api/tray
- Notifications: https://www.electronjs.org/docs/latest/tutorial/notifications
- `systemPreferences` (camera access): https://www.electronjs.org/docs/latest/api/system-preferences
- MDN CSS transforms (how the flipbook slides): https://developer.mozilla.org/en-US/docs/Web/CSS/transform

**If you finish early:**
- an always-on-top mini Maizy window (`alwaysOnTop: true, frame: false, transparent: true`)
- launch at login
- an app icon
- helping Darren tune

---

### UI screens: Darren

Darren owns `src/ui/`. Nobody else should edit it. The UI covers:
- **Welcome / camera permission screen.**
- **Calibration screen:** "sit up tall" instructions and a progress ring driven by `calibrationProgress`.
- **Live dashboard:**
  - a slot for Jordan's video and overlay (`#camera-video`, `#camera-overlay`)
  - a slot for Maizy (`#maizy`)
  - the score
  - current issues, showing the medical and plain-language names
  - a suggested stretch
- **Stretch screen:** follows Joseph's stretch events.
- **Settings:** voice on/off, sensitivity, recalibrate, pause.
- **"Not medical advice"** footer.

The UI only calls the module APIs in Section 3.4 and only reads `PostureState`. If your module needs something from the UI, tell Darren.

---

## 8. Demo plan & fallbacks

### 2-minute demo script
1. **Hook (15 s):** "How's your posture right now? Most of us are slowly turning into question marks."
2. **Calibrate (15 s):** open the app → "sit up tall" → done. Mention that everything runs on the laptop and no video leaves it.
3. **Slouch (30 s):** push the neck forward:
   - Maizy copies it.
   - The score drops.
   - After about 5 seconds the voice names the issue: "Forward head posture: neck too far out."
   - Point at the medical and plain-language labels.
4. **Fix (30 s):** start the suggested chin-tuck stretch. The voice guides it, the score recovers, and Maizy celebrates.
5. **Background (15 s):** hide the window, show the tray score and a notification. If you have both laptops, mention it runs on Mac and Windows.
6. **Close (15 s):** what's next and who built what.

### Fallbacks

| If this fails… | Then… |
|---|---|
| ElevenLabs API or Wi-Fi | Pre-generated mp3s already cover every fixed line |
| MediaPipe loading from the internet | It's bundled locally (Track 1, milestone 6) |
| Packaged app (`.app` or `.exe`) | Demo from `npm start` |
| Live detection is flaky at the venue | Play `transition.json` through the app with a hidden "replay" switch, or show the backup video |
| Venue lighting is bad | Bring a desk lamp, or sit facing a window |
| Everything | The backup demo video recorded at hour 20 |

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Electron** | Puts a hidden copy of Chrome inside a desktop app, so you build the app with HTML, CSS and JS |
| **Main process** | Electron's "backend". It's Node.js, can touch the OS (tray, notifications, files) and holds secrets |
| **Renderer** | Electron's "frontend": the window where our camera, Maizy and UI run |
| **Preload / IPC** | The safe bridge between the renderer and the main process (`window.api`) |
| **MediaPipe** | Google's on-device ML library. `PoseLandmarker` finds 33 body points in an image |
| **Landmark** | One body point (x, y, z, visibility) |
| **Normalized coordinates** | Positions as fractions from 0 to 1 instead of pixels |
| **WASM** | WebAssembly. It lets MediaPipe's fast code run inside the browser or Electron |
| **Calibration / baseline** | The user's own "good posture" numbers, which we compare everything against |
| **Severity** | How bad one issue is, from 0 to 1 |
| **EMA (moving average)** | Smoothing that blends each new value with the recent average, so numbers don't jitter |
| **Hysteresis** | Different thresholds to turn an issue on and off, so it doesn't flicker |
| **Sustained** | An issue that has lasted past the alert threshold (~5 s). Only sustained issues trigger alerts |
| **Contract** | The agreed shape of data and function names between tracks (Section 3) |
| **TTS** | Text-to-speech |
