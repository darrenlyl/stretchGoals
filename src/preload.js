// Bridge between the window and the main process. Adds window.api (contract 3.5).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Returns a Promise of mp3 bytes.
  tts: (text) => ipcRenderer.invoke('tts', text),

  notify: (title, body) => ipcRenderer.send('notify', title, body),

  // score is a number, or null to show "–".
  setTrayScore: (score) => ipcRenderer.send('set-tray-score', score),

  // cb gets 'pause' | 'resume' | 'recalibrate' | 'show'. Returns an unsubscribe function.
  onTrayCommand: (cb) => {
    const listener = (_event, command) => cb(command);
    ipcRenderer.on('tray-command', listener);
    return () => ipcRenderer.removeListener('tray-command', listener);
  },
});
