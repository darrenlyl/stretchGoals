// Milestone 1: prove we can turn text into speech with ElevenLabs.
// Run from the repo root:  node --env-file=.env src/voice/try-tts.mjs
import { writeFile } from "node:fs/promises";

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID; // ElevenLabs dashboard -> Voices -> copy ID
// Team pick: v4 Turbo with Ellie's clone. Fast enough for live (~100 ms), and the Ossie agent can use it too.
// Speed: 0.7 (slow) to 1.2 (fast). Tune these by ear with src/voice/tune-voice.mjs.
const MODEL_ID = "eleven_v4_turbo";
const SPEED = 0.9;

if (!process.env.ELEVENLABS_API_KEY) {
  throw new Error("Missing ELEVENLABS_API_KEY. Put it in .env (see .env.example).");
}
if (!VOICE_ID) {
  throw new Error("Missing ELEVENLABS_VOICE_ID. Put it in .env (see .env.example).");
}

const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
  method: "POST",
  headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    text: "Hey! Your neck is drifting forward.",
    model_id: MODEL_ID,
    voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: SPEED },
  }),
});
if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

await writeFile("hello.mp3", Buffer.from(await res.arrayBuffer()));
console.log("Wrote hello.mp3");
