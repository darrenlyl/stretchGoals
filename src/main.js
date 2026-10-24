// Main process: window, camera permission, and window.api handlers.
import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  systemPreferences,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

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

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
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
};

app.whenReady().then(async () => {
  // Mac asks for camera permission. Windows uses its Settings instead.
  if (process.platform === 'darwin') {
    const allowed = await systemPreferences.askForMediaAccess('camera');
    console.log('Camera access:', allowed ? 'allowed' : 'denied');
  }

  createWindow();

  // Mac: reopen the window when the dock icon is clicked.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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
  new Notification({ title: String(title), body: String(body ?? '') }).show();
});

// setTrayScore(score): just logs for now. The tray comes in Job 4.
let trayScore = null;
ipcMain.on('set-tray-score', (_event, score) => {
  trayScore = typeof score === 'number' ? Math.round(score) : null;
  console.log('Tray score:', trayScore ?? '–');
});

// Sends 'pause' | 'resume' | 'recalibrate' | 'show' to the window. Used by the tray in Job 4.
function sendTrayCommand(command) {
  mainWindow?.webContents.send('tray-command', command);
}
