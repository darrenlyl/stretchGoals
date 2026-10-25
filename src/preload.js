// Bridge between the window and the main process. Adds window.api (contract 3.5).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Returns a Promise of mp3 bytes.
  tts: (text) => ipcRenderer.invoke('tts', text),

  notify: (title, body) => ipcRenderer.send('notify', title, body),

  // Returns a Promise of a signed URL for one call with Maizy (the API key stays in main).
  maizySignedUrl: () => ipcRenderer.invoke('maizy-signed-url'),

  // { call, wake, listenOn }: drives the Maizy dot and menu items in the tray.
  setMaizyStatus: (status) => ipcRenderer.send('set-maizy-status', status),

  // true/false when the window pauses or resumes itself, so the tray's Pause/Resume item matches.
  setPaused: (paused) => ipcRenderer.send('set-paused', paused),

  // score is a number, or null to show "–".
  setTrayScore: (score) => ipcRenderer.send('set-tray-score', score),

  // cb gets 'pause' | 'resume' | 'recalibrate' | 'show' | 'talk' | 'end-call' | 'toggle-listen'. Returns an unsubscribe function.
  onTrayCommand: (cb) => {
    const listener = (_event, command) => cb(command);
    ipcRenderer.on('tray-command', listener);
    return () => ipcRenderer.removeListener('tray-command', listener);
  },
});
