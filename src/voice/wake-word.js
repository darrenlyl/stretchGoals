// "Hey Maizy": listens to the microphone and calls onWake when it hears her name.
// Runs fully OFFLINE with Vosk (speech recognition on this laptop): no audio leaves the computer
// and it costs nothing. Only after it hears "Hey Maizy" does the app open a (paid) call.
//
//   const wake = createWakeWord({ Vosk, onWake, isBlocked });
//   await wake.start()   loads the model once (41 MB, cached after the first time) and opens the mic
//   wake.stop()          closes the mic (the model stays loaded)
//   wake.onState(cb)     cb(state, detail): "off" | "loading" | "listening" | "error"
//
// Vosk is the vosk-browser module, passed in so the app can use the npm package and the test
// page a CDN copy. isBlocked() returning true makes it ignore what it hears, e.g. while the voice
// coach talks: one of its lines is "Hey, Maizy here", and she shouldn't wake herself up.

export const MODEL_URL = "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz";

// Vosk doesn't know the made-up name "Maizy", so it writes down a word that sounds like it.
// Tuned on recordings of "Hey Maizy"; add a spelling here if it misses yours.
export const WAKE_PATTERN = /\b(hey|hi|hay|a|okay|ok)\s+(maizy|maisie|maisy|maisey|mazy|macy|maize|mays|daisy|amazing|may see|may c|mae see)\b/;

const COOLDOWN_MS = 3000; // one "Hey Maizy" wakes her once, even though Vosk reports it several times

let modelPromise = null; // shared: loading 41 MB once per app run is plenty

// Two soft rising notes, made in code (no sound file). Its own AudioContext, because the mic's
// one closes as soon as the call takes over the microphone.
function chime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + i * 0.09);
      gain.gain.linearRampToValueAtTime(0.15, t + i * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.25);
    });
    setTimeout(() => ctx.close(), 500);
  } catch {
    // no audio output: the call still starts
  }
}

// The model from the Cache API when we have it, otherwise downloaded and stored for next time.
async function loadModel(Vosk, url) {
  let modelUrl = url;
  try {
    const cache = await caches.open("maizy-wake-word");
    let res = await cache.match(url);
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error(`model download failed (${res.status})`);
      await cache.put(url, res.clone());
    }
    modelUrl = URL.createObjectURL(await res.blob());
  } catch (err) {
    console.warn("[wake-word] no model cache, downloading directly:", err.message ?? err);
  }
  // The CDN copy has createModel at the top; Vite's bundled copy puts it under default.
  return (Vosk.createModel ?? Vosk.default.createModel)(modelUrl);
}

export function createWakeWord({ Vosk, onWake, isBlocked = () => false, modelUrl = MODEL_URL }) {
  let wanted = false; // start() asked for and no stop() since
  let mic = null; // { stream, ctx, source, node, recognizer } while listening
  let lastWakeAt = 0;
  const listeners = new Set();
  const emit = (state, detail) => listeners.forEach((cb) => cb(state, detail));

  function heard(text) {
    if (!text || isBlocked() || !WAKE_PATTERN.test(text)) return;
    const now = Date.now();
    if (now - lastWakeAt < COOLDOWN_MS) return;
    lastWakeAt = now;
    chime(); // instant "I heard you" while the call connects
    onWake(text);
  }

  async function start() {
    if (wanted) return;
    wanted = true;
    emit("loading");
    try {
      modelPromise ??= loadModel(Vosk, modelUrl);
      const model = await modelPromise;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      if (!wanted) return stream.getTracks().forEach((t) => t.stop()); // stop() came while we were loading

      const ctx = new AudioContext();
      const recognizer = new model.KaldiRecognizer(ctx.sampleRate);
      recognizer.on("partialresult", (m) => heard(m.result.partial));
      recognizer.on("result", (m) => heard(m.result.text));
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(2048, 1, 1); // small chunks = hears you sooner
      node.onaudioprocess = (e) => {
        if (!isBlocked()) recognizer.acceptWaveform(e.inputBuffer);
      };
      source.connect(node);
      node.connect(ctx.destination); // must be connected to run; it outputs silence
      mic = { stream, ctx, source, node, recognizer };
      emit("listening");
    } catch (err) {
      wanted = false;
      if (String(err).includes("model")) modelPromise = null; // let the next start() try again
      console.error("[wake-word]", err);
      emit("error", err.name === "NotAllowedError" ? "Microphone access is blocked." : String(err.message ?? err));
    }
  }

  function stop() {
    wanted = false;
    if (mic) {
      mic.node.onaudioprocess = null;
      mic.source.disconnect();
      mic.node.disconnect();
      mic.stream.getTracks().forEach((t) => t.stop());
      mic.ctx.close();
      mic.recognizer.remove();
      mic = null;
    }
    emit("off");
  }

  return { start, stop, onState: (cb) => (listeners.add(cb), () => listeners.delete(cb)) };
}
