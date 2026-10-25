// Main process: window, camera permission, and window.api handlers.
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  systemPreferences,
  Tray,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { TRAY_ICON_16, TRAY_ICON_32 } from './tray-icon.js';

// Windows installer shortcut handling.
if (started) {
  app.quit();
}

// Only one copy at a time: two would fight over the camera, the mic and the saved data.
// A second launch just brings the first one's window forward.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}
// A copy that is about to quit (second launch, Squirrel installer event) must not open a window or tray first.
const exiting = started || !gotLock;

// Load secrets from .env. Only the main process can see them.
// npm start uses the project's .env. The packaged app uses one in its data folder
// (Mac: ~/Library/Application Support/stretchGoals/.env).
const envFiles = [
  path.join(process.cwd(), '.env'),
  path.join(app.getPath('userData'), '.env'),
];
const envFile = envFiles.find((file) => fs.existsSync(file));
if (envFile) {
  process.loadEnvFile(envFile);
} else {
  console.warn(
    `No .env file found. Voice (tts) will not work until you add one at ${envFiles[1]}`,
  );
}

// Windows needs an app ID for notifications to show.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.stretchgoals.app');
}

let mainWindow;
// True once the user really quits (tray Quit, Cmd+Q). Until then, closing only hides the window.
let isQuitting = false;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    // Big enough for the UI's dashboard layout (camera, Maizy and score side by side)
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Keep timers running at full speed when the window is hidden, so posture checks continue.
      backgroundThrottling: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // DevTools only while developing, not in the packaged app
  if (!app.isPackaged) mainWindow.webContents.openDevTools();

  // Closing the window hides it; the app keeps running in the tray.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
};

app.whenReady().then(async () => {
  if (exiting) return;

  // Mac asks for camera permission. Windows uses its Settings instead.
  if (process.platform === 'darwin') {
    const allowed = await systemPreferences.askForMediaAccess('camera');
    console.log('Camera access:', allowed ? 'allowed' : 'denied');
  }

  createWindow();
  createTray();

  // The mic is for "Hey Maizy" and for talking to her. Asked after the window opens, so
  // an unanswered prompt doesn't hold the app up.
  if (process.platform === 'darwin') {
    systemPreferences
      .askForMediaAccess('microphone')
      .then((mic) =>
        console.log('Microphone access:', mic ? 'allowed' : 'denied'),
      );
  }

  // Mac: clicking the dock icon brings the hidden window back.
  app.on('activate', showWindow);
});

// maizySignedUrl(): a short-lived link (about 15 minutes, this agent only) for one call with Maizy.
// The API key stays here; the window only ever sees the link.
ipcMain.handle('maizy-signed-url', async () => {
  const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } = process.env;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    throw new Error(
      'Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID in .env',
    );
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
    { headers: { 'xi-api-key': ELEVENLABS_API_KEY } },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).signed_url;
});

// Any real quit (tray Quit, Cmd+Q, shutting down) lets the window close.
app.on('before-quit', () => {
  isQuitting = true;
});

// Quit when the window closes, except on Mac.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- window.api handlers (see preload.js) ---

// Same voice settings as Joseph's scripts.
const TTS_MODEL_ID = 'eleven_v4_turbo';
const TTS_SPEED = 0.9;
// Stops a bug from burning ElevenLabs credits.
const TTS_MAX_CHARS = 500;

// tts(text): returns mp3 bytes from ElevenLabs.
ipcMain.handle('tts', async (_event, text) => {
  const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } = process.env;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    throw new Error(
      'Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in .env',
    );
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('tts(text) needs a non-empty string');
  }
  if (text.length > TTS_MAX_CHARS) {
    throw new Error(
      `tts text is too long (${text.length} > ${TTS_MAX_CHARS} chars)`,
    );
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: TTS_MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: TTS_SPEED,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
});

// notify(title, body): desktop notification.
ipcMain.on('notify', (_event, title, body) => {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: String(title),
    body: String(body ?? ''),
  });
  // Clicking the notification opens the app
  notification.on('click', showWindow);
  notification.show();
});

// setTrayScore(score): update the number in the tray.
ipcMain.on('set-tray-score', (_event, score) => {
  const next = typeof score === 'number' ? Math.round(score) : null;
  // This arrives ~10 times a second, so only redraw when the number changes.
  if (next === trayScore) return;
  trayScore = next;
  if (tray) updateTrayScore();
});

// setMaizyStatus({ call, wake, listenOn }): the dot next to the tray score and the Maizy menu items.
//   call: 'idle' | 'connecting' | 'talking'   wake: 'off' | 'loading' | 'listening' | 'error'
ipcMain.on('set-maizy-status', (_event, status) => {
  const next = {
    call: String(status?.call ?? 'idle'),
    wake: String(status?.wake ?? 'off'),
    listenOn: Boolean(status?.listenOn),
  };
  if (JSON.stringify(next) === JSON.stringify(maizyStatus)) return;
  maizyStatus = next;
  if (tray) {
    updateTrayScore();
    updateTrayMenu();
  }
});

// setPaused(paused): the window paused or resumed itself (its own button), so the tray menu follows.
ipcMain.on('set-paused', (_event, value) => {
  const next = Boolean(value);
  if (next === paused) return;
  paused = next;
  if (tray) updateTrayMenu();
});

// Sends 'pause' | 'resume' | 'recalibrate' | 'show' | 'talk' | 'end-call' | 'toggle-listen' to the window.
function sendTrayCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tray-command', command);
  }
}

// --- Tray: menu bar on Mac, system tray on Windows ---

let tray = null; // kept at the top level so it isn't garbage-collected and vanish
let trayScore = null;
let paused = false;
let maizyStatus = { call: 'idle', wake: 'off', listenOn: false };

// What Maizy is doing, in words (menu) and as a dot before the score (Mac menu bar).
function maizyLine() {
  if (maizyStatus.call === 'connecting') return 'Calling Maizy…';
  if (maizyStatus.call === 'talking') return 'Talking to Maizy';
  return {
    listening: 'Listening for “Hey Maizy”',
    loading: 'Getting “Hey Maizy” ready…',
    error: '“Hey Maizy” isn’t working',
    off: '“Hey Maizy” is off',
  }[maizyStatus.wake];
}
function maizyDot() {
  if (maizyStatus.call !== 'idle') return '◉ '; // on a call
  if (maizyStatus.wake === 'listening') return '• '; // listening for her name
  return '';
}

function createTray() {
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, dataURL: TRAY_ICON_16 });
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_32 }); // Retina screens
  icon.setTemplateImage(true); // Mac recolours it for dark mode

  tray = new Tray(icon);
  // Windows: left-click opens the window (right-click shows the menu).
  if (process.platform === 'win32') tray.on('click', showWindow);

  updateTrayScore();
  updateTrayMenu();
}

function updateTrayScore() {
  const text = trayScore === null ? '–' : String(trayScore);
  // Mac shows text next to the icon. Windows ignores setTitle, so it gets the tooltip.
  if (process.platform === 'darwin') {
    tray.setTitle(` ${maizyDot()}${text}`, { fontType: 'monospacedDigit' });
  }
  tray.setToolTip(`Posture: ${text} · ${maizyLine()}`);
}

// Rebuilt when paused or Maizy's status changes, so the items match.
function updateTrayMenu() {
  const onCall = maizyStatus.call !== 'idle';
  const menu = Menu.buildFromTemplate([
    { label: maizyLine(), enabled: false },
    onCall
      ? { label: 'End call', click: () => sendTrayCommand('end-call') }
      : { label: 'Talk to Maizy', click: () => sendTrayCommand('talk') },
    {
      label: 'Listen for “Hey Maizy”',
      type: 'checkbox',
      checked: maizyStatus.listenOn,
      click: () => sendTrayCommand('toggle-listen'),
    },
    { type: 'separator' },
    { label: 'Show window', click: showWindow },
    { label: paused ? 'Resume' : 'Pause', click: togglePause },
    {
      label: 'Recalibrate',
      click: () => {
        showWindow();
        sendTrayCommand('recalibrate');
      },
    },
    { type: 'separator' },
    { label: 'Quit stretchGoals', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function showWindow() {
  // On Mac the window may have been closed while the app kept running.
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
  sendTrayCommand('show');
}

function togglePause() {
  paused = !paused;
  sendTrayCommand(paused ? 'pause' : 'resume');
  updateTrayMenu();
}
