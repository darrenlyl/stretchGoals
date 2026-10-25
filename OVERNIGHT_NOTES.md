# Overnight notes: `joseph/vision-ui-overhaul`

Branched from `joseph/voice`. There was no `joseph/vision` branch on GitHub, so `joseph/voice` was the base. Nothing was pushed to any other branch.

## Try it

```
git fetch && git checkout joseph/vision-ui-overhaul
npm install
npm start
```

UI playground with fake posture, no camera needed: run `npx vite`, then open `http://localhost:5173/src/ui/dev.html`.

## 1. The new UI (`src/ui/`)

**Concept:** a physio's home exercise sheet, filled in live.
- Paper panels with thin ink lines, under a pine green header.
- One self-hosted font, Archivo (OFL licence in `src/ui/fonts/`). No internet is needed at runtime.
- Highlighter swipes mark active problems, a red-pen ring marks "Sustained", and a tick marks "Recovered".
- The score sits on a 0–100 ruler.
- Light and dark mode follow the system.

**New features.** These only change what you see. Every existing behaviour still works the same:
- **Score:** the digits roll and a needle glides along the ruler.
- **Body figures:** a side view and a front view bend with each problem's severity (neck forward, rounded back, head tilt, uneven shoulders).
- **Session strip:** time watched, % time in good posture, best streak, and a score graph you can hover over.
- **"Recovered" moment:** plays when a sustained problem clears.
- **Calibration:** a breathing guide, a 3-2-1 countdown, and a tick that draws itself.
- **Stretch:** a big countdown, step bars, and the whole routine (Hold / Steps / Total) on the dashboard card.
- **Settings sheet:** opens with a spring. It has two new controls:
  - **Show skeleton on camera:** calls `camera.setOverlayVisible`. Nothing called it before.
  - **Camera picker:** uses Jordan's `listCameras` / `switchCamera`, and only shows with 2 or more cameras.
- **Shortcuts:** `P` pause, `S` or `,` settings, `Esc` close.
- **Reduced motion:** honoured everywhere.

**Unchanged:**
- The `ui` API: `mount`, `update`, `onPauseChange`, `setPaused`, `isPaused`, `showScreen`.
- The `#camera-video`, `#camera-overlay` and `#maizy` slots.
- Every button label, so Maizy can still press the buttons by voice.

New files: `motion.js` (spring curves, smooth movement, layout moves), `figure.js` (the body figures), `session.js` (stats and graph).

### Front-end skills used, and what each changed

| Skill | What it changed |
|---|---|
| impeccable | Chose the exercise-sheet direction; two critique rounds with screenshots |
| design-taste-frontend | No eyebrows or dashes in visible text; one radius for every panel and control |
| emil-design-eng | Settings opens instantly from the keyboard; buttons shrink slightly when pressed |
| animate | Strong ease-out curves, under 300 ms except screen changes |
| apple-design | Settings sheet springs in (damping 0.8) and leaves the way it came |
| animation-vocabulary | Motion is named in code comments (number ticker, reveal, layout animation) |
| dataviz | Score graph: one series, faint 50/80 guide lines, no legend, hover readout |
| find-animation-opportunities | Problem list, empty states, score and camera chip now fade in instead of popping |
| improve-animations | Shorter entrances; fixed the stretch card flickering when two problems swap places |
| animation-performance | Movement uses transform, opacity, clip-path and stroke only; colours and shadows ease. The one exception is the score's font width shifting on a tone change, which stays inside its card |
| break-ui | Fixed: a score of 0 showing "000", the severity bar overlapping "Sustained", a long stretch name hiding Start, problem rows not lining up |

## 2. Things that weren't connected, now fixed

| Problem | Fix | Files |
|---|---|---|
| Pausing in the app never updated the tray, which kept saying "Pause" | New `window.api.setPaused(bool)`; app.js calls it whenever pause changes | `preload.js`, `main.js`, `app.js`, comment in `contracts.js` |
| Tray **Recalibrate** showed the calibrate screen but kept the old baseline | Now resets the baseline first, like Settings → Recalibrate. Does nothing before the camera is on, so the screen can't hang with no frames | `app.js` |
| A second launch flashed a window, tray and mic before quitting | A second copy (or a Squirrel installer event) now exits before creating anything | `main.js` |
| Jordan's camera picker and Windows Hello IR-camera fix (`d5e7dd7`) never reached this branch | Brought in from `jordan/camera`, **without** its `notifications.js` change (test cooldowns of 5 s / 3 s) | `src/camera/`, `data/recordings/` |
| Nothing called `setOverlayVisible`; nothing used the camera picker | New Settings controls (see above) | `src/ui/` |

Checked and already working:
- the voice coach follows stretch events
- Maizy cheers when a problem clears
- sensitivity reaches posture
- a missing `.env` logs clearly and doesn't crash
- the MediaPipe model and wasm load in the packaged app

## 3. Left for you to decide

- **"Hey Maizy" model:** a 41 MB Vosk download from a CDN on first run, then cached. So the first run needs internet. Bundle it if the demo laptop might be offline.
- **Notification cooldown:** 10 s (your commit `edf30a4`), against the guide's 3 min. I left it alone.
- **`origin/darren` 29208e7:** an Ossie → Maizy rename that touches `src/ui/`, so it will conflict with this redesign. Re-apply it by hand if it still matters.
- **Unplugging the camera** isn't handled, so the score freezes on the last pose.
- **Pre-generated audio:** `src/voice/audio/` doesn't exist. Every line is live TTS.
- **Unused voice lines:** six lines in `lines.js` are never spoken.
- **"Hey Maizy" with no keys:** the listener starts, and downloads its model, even with no ElevenLabs keys in `.env`.
- **Shared data folder:** your other copy at `E:\2026Hackathon\stretchGoals` uses the same `%APPDATA%\StretchGoals` folder. If both run, the second one quits silently (single-instance lock).
- **Formatting check:** `npm run lint` reports every file because of Windows CRLF line endings (`core.autocrlf`). oxlint itself is clean.
- **Small windows:** below 900×640, the welcome screen needs a short scroll to reach Start camera.

## How it was checked

- **A fresh verifier ran the real app** (`electron-forge start`) with a fake camera, driven over CDP:
  - It went through Start camera → calibrate → dashboard → stretch → stop → Settings (every control) → Pause/Resume.
  - Console errors: none.
  - No horizontal scroll at 800×600 or 1440×900, in light or dark.
  - Reduced motion works.
  - Maizy sees only the buttons on the current screen.
- **Lint and build:** `npx oxlint` has no errors, and `npx vite build --config vite.renderer.config.mjs` builds.
- **Packaged build:** it loaded the pose model and wasm from `app.asar`.
- **Posture replays** score as expected: upright 100, slouch 50, empty null.

**Not tested** (needs real hardware or keys):
- the tray's Pause label after you pause in the app (checked by reading the code only)
- detection while the window is hidden, with a real camera
- a real Maizy voice call
