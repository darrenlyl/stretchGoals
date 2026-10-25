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
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { TRAY_ICON_16, TRAY_ICON_32 } from './tray-icon.js';

// Windows installer shortcut handling.
if (started) {
  app.quit();
}

// Load secrets from .env. Only the main process can see them.
try {
  process.loadEnvFile();
} catch {
  console.warn('No .env file found. Voice (tts) will not work until you add one.');
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
    width: 800,
    height: 600,
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

  mainWindow.webContents.openDevTools();

  // Closing the window hides it; the app keeps running in the tray.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
};

app.whenReady().then(async () => {
  // Mac asks for camera permission. Windows uses its Settings instead.
  if (process.platform === 'darwin') {
    const allowed = await systemPreferences.askForMediaAccess('camera');
    console.log('Camera access:', allowed ? 'allowed' : 'denied');
  }

  createWindow();
  createTray();

  // Mac: clicking the dock icon brings the hidden window back.
  app.on('activate', showWindow);
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
    throw new Error('Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in .env');
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('tts(text) needs a non-empty string');
  }
  if (text.length > TTS_MAX_CHARS) {
    throw new Error(`tts text is too long (${text.length} > ${TTS_MAX_CHARS} chars)`);
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
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: TTS_SPEED },
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
  const notification = new Notification({ title: String(title), body: String(body ?? '') });
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

// Sends 'pause' | 'resume' | 'recalibrate' | 'show' to the window.
function sendTrayCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tray-command', command);
  }
}

// --- Tray: menu bar on Mac, system tray on Windows ---

let tray = null; // kept at the top level so it isn't garbage-collected and vanish
let trayScore = null;
let paused = false;

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
    tray.setTitle(` ${text}`, { fontType: 'monospacedDigit' });
  }
  tray.setToolTip(`Posture: ${text}`);
}

// Rebuilt when paused changes, so the item says Pause or Resume.
function updateTrayMenu() {
  const menu = Menu.buildFromTemplate([
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
